# 誰もしらんペディア

誰でも自由に写真と情報を登録できる、完全匿名の参加型オンライン百科事典です。
コンセプトは「誰かが、なんか載せている謎の辞書サイト」。

- アカウント登録・ログインなし（投稿は任意のニックネーム、未入力なら「匿名」）
- 記事の作成・編集・検索・写真アップロード・編集履歴と過去版への復元
- 書き込みはサーバー側で頻度制限（接続元IPのハッシュ単位）
- 管理者だけは別の非公開ログインで、報告処理・記事の非公開化/削除・投稿制限を行う
- コメント・いいね・フォロー・ランキング等の交流機能はなし

## 構成

| 役割 | 採用 |
|---|---|
| フロントエンド | `public/index.html`（単一ページアプリ、ハッシュルーティング） |
| API | `api/` 以下の Vercel サーバーレス関数（Node、依存パッケージなし） |
| データベース | Supabase (PostgreSQL) |
| 画像保存 | Supabase Storage（バケット `article-images`、公開読み取り） |
| ホスティング | Vercel 無料プラン（独自ドメインなし、無料サブドメイン） |

ブラウザは Supabase へ直接アクセスせず、全ての読み書きは `/api` 経由です。
サービスロールキーはサーバー側（環境変数）だけに置きます。

## セットアップ手順

### 1. Supabase にテーブルを作る

1. Supabase ダッシュボードでプロジェクトを開く
2. 左メニューの「SQL Editor」を開く
3. リポジトリ内の `schema.sql` の内容を貼り付けて実行する（1回だけ）
   - テーブル7つ（articles / article_images / revisions / reports / rate_limits / bans / admin_actions）と、画像用バケットが作成されます

### 2. 管理者ユーザーを作る

1. Supabase ダッシュボード → Authentication → Users →「Add user」
2. 管理者用のメールアドレスとパスワードを設定して作成する
3. 作成したユーザーの **ID** を控える（後で `ADMIN_USER_ID` に設定）
4. ついでに Authentication の設定で **新規ユーザー登録を無効化** する
   （一般ユーザーは登録制ではないため。管理者以外の Auth ユーザーを作らせない）

### 3. Vercel にデプロイする

1. このリポジトリを GitHub に push し、Vercel で Import する
2. Vercel の Project Settings → Environment Variables に以下を設定する（`.env.example` 参照）
   - `SUPABASE_URL` … Supabase の Project URL
   - `SUPABASE_SERVICE_KEY` … secret / service_role キー（Settings → API Keys）
   - `IP_HASH_SALT` … ランダムな長い文字列（例: パスワード生成器で作った64文字）
   - `ADMIN_USER_ID` … 手順2で控えたユーザーID
   - `ADMIN_SESSION_SECRET` … ランダムな長い文字列（IP_HASH_SALT とは別の値）
   - `TURNSTILE_SECRET` … 任意（手順4を行う場合のみ）
3. Deploy する。以後は GitHub へ push するたびに自動デプロイされる

### 4. （任意）Turnstile でスパム対策を強める

1. Cloudflare に Turnstile のサイトを作成し、サイトキーとシークレットキーを取得する
2. `public/config.js` の `turnstileSiteKey` にサイトキーを書く
3. Vercel の環境変数 `TURNSTILE_SECRET` にシークレットキーを設定する
4. 両方そろうと、投稿・編集・復元・報告・アップロードで認証が有効になる
   （片方だけ設定すると投稿が失敗するので注意）

## 運用メモ

- **頻度制限の暫定値**: 書き込み（作成・編集・復元）は IPハッシュ単位で1日10回まで＋1分間隔、報告は1日5回まで、アップロードは1日60回まで。値は `api/_lib.js` 冒頭の定数で変更できます（オーナー確認のうえ確定予定）。
- **復元の範囲**: 過去版への復元で戻るのはタイトル・本文・カテゴリ・タグ・関連記事です。写真は版管理の対象外のため、復元しても現在の写真が維持されます。
- **情報ボックス**: データベースに専用列がないため、本文先頭の `{{情報ボックス |項目=内容 }}` 記法として本文と一緒に保存・版管理されます。編集画面では専用欄として分かれて表示されます。
- **画像の上限**: 1枚5MBまで（JPEG/PNG/WebP/GIF）。フロント側で長辺1600px以下に圧縮してから送るため、通常は数百KBに収まります。Vercel の関数ボディ上限（約4.5MB）の都合で、base64 のまま送れる実効上限は約3MB強です。
- **IPハッシュの保持**: rate_limits / revisions / reports にハッシュ値が残ります。プライバシーポリシーでは保持期間を最長30日目安と案内しているため、古い rate_limits 行は Supabase の SQL Editor から定期的に削除してください（例: `delete from public.rate_limits where day < current_date - 30;`）。
- **無料プランの注意**: Supabase 無料プランは DB へのアクセスが約1週間途絶えるとプロジェクトが一時停止します。サイトへのアクセス自体が DB 利用になるため通常は起きにくいですが、復帰が必要な場合はダッシュボードから再開してください。
- **管理画面**: サイト右上の「管理」から開きます。ログインには手順2の管理者アカウントを使います。管理操作は全て `admin_actions` に記録されます。

## ディレクトリ

```
public/index.html   フロントエンド本体
public/config.js    公開設定（Turnstile サイトキー）
api/_lib.js         共通処理（Supabase接続、頻度制限、検証、管理セッション）
api/home.js         トップページ用データ
api/random.js       ランダム記事
api/articles/       記事の検索・一覧・詳細・作成・編集・復元・履歴
api/reports.js      違反報告
api/upload.js       画像アップロード
api/admin/          管理者用（ログイン、報告処理、非公開化、削除、BAN、操作履歴）
schema.sql          Supabase 用テーブル作成SQL
vercel.json         Vercel 設定（ヘッダのみ。ルーティングは標準動作）
```
