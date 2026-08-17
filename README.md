# Nagi — 端末内で完結する翻訳 PWA（macOS）

Firefox の翻訳機能と**同じエンジン（Bergamot / Marian NMT）と同じモデル（mozilla/firefox-translations-models）**を、
自前の PWA として動かします。ブラウザを選ばず、初回セットアップ以降は完全にオフラインで動作します。

- 翻訳テキストはネットワークに一切出ません
- Chrome / Brave / Edge のどれでもインストール可（Google のモデル配信に依存しません）
- 言語ペアあたり数十MB。Chrome の Translator API のような 22GB の空き容量は不要です

---

## 1. 必要なもの

```bash
brew install node git-lfs
git lfs install
xcode-select --install    # git が未導入の場合のみ
```

Python は macOS 標準の `python3` を使います（追加インストール不要）。

## 2. セットアップ

```bash
cd bergamot-pwa
chmod +x setup.sh serve.py
./setup.sh
```

エンジンを `vendor/` に、モデルを `models/` に配置します。ネットワークを使うのはこの一度だけです。
全言語ペアで 1GB 前後になるので、不要なペアは `models/` から消して構いません（`models/registry.json` の対応するキーも消します）。

## 3. 起動とインストール

```bash
./serve.py
```

`http://localhost:8787` が開きます。`localhost` は secure context 扱いなので、これだけで PWA として成立します。

Chrome / Brave なら、アドレスバー右端のインストールアイコン、または
**メニュー → キャスト、保存、共有 → ページをアプリとしてインストール** から追加してください。
以降は Dock やアプリケーションフォルダから、独立したウィンドウとして起動できます。

ログイン時に自動でサーバーを立ち上げたい場合は `com.nagi.server.plist` を使ってください（ファイル内に手順のコメントがあります）。

## 4. 使い方

| 操作 | キー |
|---|---|
| 翻訳を即実行 | `⌘Enter` |
| 訳文をコピー | `⌘⇧C` |

入力を止めて 0.35 秒で自動翻訳します。左側の「貼り付け」ボタンでクリップボードの内容を読み込めます（初回に権限の確認が出ます。許可しなくても ⌘V での手動貼り付けで普通に使えます）。

## 5. ホットキーから呼び出す

翻訳ツールは「呼び出しの速さ」がすべてなので、ここまでやると DeepL アプリと同じ操作感になります。

**Raycast**（推奨）
Extensions → Quicklinks で `http://localhost:8787` を登録し、ホットキーを割り当てます。
PWA としてインストール済みなら、Raycast のアプリ検索から `Nagi` を直接呼ぶだけでも十分です。

**Automator + システム設定**
1. Automator で「クイックアクション」を新規作成
2. 「アプリケーションを起動」で Nagi を選択
3. 保存後、システム設定 → キーボード → キーボードショートカット → サービス でキーを割り当て

選択テキストを渡したい場合は、クイックアクションを「シェルスクリプトを実行」にして次を入れます。

```bash
pbcopy <<< "$1"
open -a "Nagi"
```

## 6. うまく動かないとき

**「vendor/translator.js が見つかりません」**
`./setup.sh` が途中で失敗しています。もう一度実行し、エラーメッセージを確認してください。

**「models/registry.json を読めません」**
`git lfs install` を忘れると、モデルの実体ではなくポインタファイルが落ちてきます。
`git lfs install` を実行してから `./setup.sh` をやり直してください。

**特定の言語ペアだけエラーになる**
Firefox のモデルは全組み合わせを網羅していません。直接のペアが無い場合は英語を経由する必要があります。
`models/registry.json` に該当キー（例: `jaen`）があるか確認してください。

**日本語の訳文が不自然**
Bergamot のモデルは速度重視の軽量版（student model）で、日英は不得手です。
意味の把握には十分ですが、DeepL 相当の自然さが要るときは、ローカル LLM（LM Studio + Qwen3 など）の併用をおすすめします。

**API が変わっていたら**
`@browsermt/bergamot-translator` は更新頻度が低いものの、クラス名や引数が変わる可能性があります。
`app.js` は `LatencyOptimisedTranslator` → `BatchTranslator` → `default` の順に探す作りにしてあります。
それでも動かない場合は `vendor/README.md`（パッケージ同梱）と
https://github.com/browsermt/bergamot-translator/blob/main/wasm/module/README.md を参照してください。

## 7. 構成

```
bergamot-pwa/
├── index.html              画面
├── styles.css
├── app.js                  エンジンの呼び出しと UI 制御
├── sw.js                   Service Worker（オフライン化）
├── manifest.webmanifest    PWA の定義
├── icons/
├── setup.sh                エンジンとモデルの取得
├── serve.py                COOP/COEP 付きローカルサーバー
├── com.nagi.server.plist   自動起動用（任意）
├── vendor/                 ← setup.sh が生成
└── models/                 ← setup.sh が生成
```

`serve.py` が `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` を付けています。
別のサーバーに載せ替える場合も、この2つのヘッダーは必須です（SharedArrayBuffer が無効だと WASM が動きません）。
