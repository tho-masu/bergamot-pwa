#!/usr/bin/env bash
# Nagi のセットアップ（macOS）
#   1. Bergamot 翻訳エンジン（WASM）を vendor/ に配置
#   2. Firefox の翻訳モデルを models/ に配置
# 一度実行すれば、あとはオフラインで動きます。

set -euo pipefail
cd "$(dirname "$0")"

say() { printf "\n\033[1m%s\033[0m\n" "$1"; }
die() { printf "\n\033[31m%s\033[0m\n" "$1" >&2; exit 1; }

# ---------- 前提の確認 ----------

command -v node    >/dev/null || die "Node.js がありません。 brew install node"
command -v curl    >/dev/null || die "curl がありません。"
command -v python3 >/dev/null || die "python3 がありません。"

# ---------- 1. エンジン ----------

say "1/3  Bergamot エンジンを取得します"

rm -rf .engine vendor
mkdir -p .engine vendor
(
  cd .engine
  # npm init -y はディレクトリ名(.engine)からパッケージ名を決めようとして
  # ドット始まりの名前を拒否するため、package.json を直接置く
  echo '{"name":"bergamot-pwa-engine","private":true}' > package.json
  # franc は原文の言語自動検出（「自動検出」選択時）に使う純JSライブラリ
  npm install --silent @browsermt/bergamot-translator franc
)

PKG=".engine/node_modules/@browsermt/bergamot-translator"
[ -d "$PKG" ] || die "パッケージの取得に失敗しました。"

# 版によって置き場所が違うので translator.js を探して、その階層ごと持ってくる
SRC="$(find "$PKG" -path "$PKG/node_modules" -prune -o -name 'translator.js' -print | head -n1)"
[ -n "$SRC" ] || die "translator.js が見つかりません。README の「API が変わっていたら」を参照してください。"

cp -R "$(dirname "$SRC")"/. vendor/
find "$PKG" -name '*.wasm' -exec cp {} vendor/ \; 2>/dev/null || true

# franc は複数の小さな ESM パッケージに分かれていて bare import
# （'n-gram' など）を使うため、ブラウザでそのまま読めるよう
# 1ファイルずつ相対パスに書き換えてコピーする
FRANC=".engine/node_modules/franc"
NGRAM=".engine/node_modules/n-gram"
TRIGRAM=".engine/node_modules/trigram-utils"
COLLAPSE=".engine/node_modules/collapse-white-space"
if [ -d "$FRANC" ]; then
  mkdir -p vendor/franc
  cp "$FRANC/data.js" vendor/franc/data.js
  cp "$FRANC/expressions.js" vendor/franc/expressions.js
  cp "$NGRAM/index.js" vendor/franc/n-gram.js
  cp "$COLLAPSE/index.js" vendor/franc/collapse-white-space.js
  sed -e "s/from 'n-gram'/from '.\/n-gram.js'/" \
      -e "s/from 'collapse-white-space'/from '.\/collapse-white-space.js'/" \
      "$TRIGRAM/index.js" > vendor/franc/trigram-utils.js
  sed "s/from 'trigram-utils'/from '.\/trigram-utils.js'/" \
      "$FRANC/index.js" > vendor/franc/index.js
fi

echo "  vendor/ に配置:"
find vendor -maxdepth 2 -type f | sed 's/^/    /'

# ---------- 2. モデル ----------

say "2/3  Firefox の翻訳モデルを取得します（数分かかります）"

# mozilla/firefox-translations-models はメンテナンス終了済みで Git LFS の実体が
# 消えている（全オブジェクトが 410 Gone）。後継の mozilla/translations が
# Google Cloud Storage 上に公開しているモデルレジストリから直接取得する。
MODELS_JSON_URL="https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json"

rm -rf models
mkdir -p models

REGISTRY_JSON="$(mktemp)"
trap 'rm -f "$REGISTRY_JSON"' EXIT
curl -fsSL "$MODELS_JSON_URL" -o "$REGISTRY_JSON" \
  || die "モデルレジストリを取得できませんでした（$MODELS_JSON_URL）。ネットワーク接続を確認してください。"

python3 - "$REGISTRY_JSON" <<'PYEOF'
import gzip, hashlib, json, os, sys, urllib.request

with open(sys.argv[1]) as f:
    data = json.load(f)

base_url = data["baseUrl"]
models = data["models"]

# 同じペアに複数の architecture がある場合、精度優先で採用する
ARCH_PRIORITY = {"base": 0, "base-memory": 1, "tiny": 2}

# レジストリ上のファイル種別 → translator.js が期待するキー名
FILE_PART = {
    "model": "model",
    "lexicalShortlist": "lex",
    "vocab": "vocab",
    "srcVocab": "srcvocab",
    "trgVocab": "trgvocab",
}

def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

registry_out = {}
failed = []
total = len(models)

for i, (pair_key, variants) in enumerate(sorted(models.items()), 1):
    print(f"\r  {i}/{total} 組を処理中...", end="", file=sys.stderr, flush=True)

    variants = sorted(variants, key=lambda v: ARCH_PRIORITY.get(v.get("architecture"), 99))
    chosen = variants[0]
    key = f"{chosen['sourceLanguage']}{chosen['targetLanguage']}"
    out_dir = os.path.join("models", key)

    entry = {}
    ok = True
    for field, part in FILE_PART.items():
        info = chosen["files"].get(field)
        if not info:
            continue
        url = base_url + "/" + info["path"]
        try:
            content = gzip.decompress(fetch(url))
        except Exception:
            ok = False
            break
        os.makedirs(out_dir, exist_ok=True)
        name = os.path.basename(info["path"])[:-3]  # .gz を外す
        with open(os.path.join(out_dir, name), "wb") as out:
            out.write(content)
        entry[part] = {
            "name": f"models/{key}/{name}",
            "size": len(content),
            "expectedSha256Hash": hashlib.sha256(content).hexdigest(),
        }

    has_vocab = "vocab" in entry or ("srcvocab" in entry and "trgvocab" in entry)
    if ok and "model" in entry and has_vocab:
        registry_out[key] = entry
    else:
        failed.append(pair_key)

print("", file=sys.stderr)

with open("models/registry.json", "w") as f:
    json.dump(registry_out, f, ensure_ascii=False)

print(f"  {len(registry_out)} 組の言語ペアを取得しました")
if failed:
    shown = ", ".join(failed[:15]) + (" ..." if len(failed) > 15 else "")
    print(f"  取得できなかった {len(failed)} 組はスキップしました: {shown}")
PYEOF

SIZE=$(du -sh models | cut -f1)
echo "  合計 ${SIZE}"

# ---------- 3. 後片付け ----------

say "3/3  作業用ファイルを削除します"
rm -rf .engine

say "完了しました"
cat <<'EOS'

  次はサーバーを起動します:

      ./serve.py

  ブラウザで http://localhost:8787 を開き、
  アドレスバー右端のインストールアイコンからアプリとして追加してください。

EOS
