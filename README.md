# bluesky-robust-watermarker

画像に電子透かしを埋め込んでBlueskyへ投稿してくれるクリエイター向けの Bluesky Web クライアント

## このプロジェクトの目的

BlueskyのようなSNSプラットフォームでは、デジタルアートや写真は簡単にコピー・改変され、再投稿されてしまいます。

このアプリは、投稿前のすべての画像に不可視で編集や圧縮されても失われにくい電子透かしを埋め込むことで、いつ・誰がBlueskyに投稿した画像なのかを確認できる機能を提供します。

利用用途は以下を想定しています

- **来歴の証明**: 誰が最初にその画像をBlueskyに投稿したかを検証します
- **無断転載の抑止**: 画像の出所を検証可能にすることで、不正な再投稿を抑制します
- **コンテンツの信頼性向上**: 投稿された画像の真正性を担保することで、ユーザー間の信頼を向上させます

## セットアップ

### 前提条件

- [AWS CLI](https://docs.aws.amazon.com/ja_jp/cli/latest/userguide/getting-started-install.html)
- [Node.js](https://nodejs.org/ja/download) 18以上
- [AWS CDK](https://docs.aws.amazon.com/ja_jp/cdk/v2/guide/getting-started.html) (`npm install -g aws-cdk`)
- [Route53 HostedZone](https://docs.aws.amazon.com/ja_jp/Route53/latest/DeveloperGuide/domain-register-update.html) で管理されているカスタムドメイン (NS, SOAレコードがあること)
- Python 3.10.x
  - [Poetry](https://python-poetry.org/)
- [Docker Service](https://docs.docker.com/engine/install/)
- Google OAuth 2.0 クライアントが設定済み（下記手順参照）

#### Google OAuth 2.0 クライアントの設定

このアプリは、Blueskyへ画像を投稿するクリエイター側に、Google の OAuth 2.0 を使用してユーザー認証を求める仕様です。
つまり、投稿者は `Google でサインアップ`,  `Google でログイン` をしてマイページにログインをして当アプリの機能を使います。

Google OAuth 2.0 クライアントの設定手順は以下の通りです。


1. **Google Cloud Console にアクセス**
   - [Google Cloud Console](https://console.cloud.google.com/) にログイン
   - プロジェクトを選択または新規作成

2. **Google+ API を有効化**
   - [APIs & Services > Library](https://console.cloud.google.com/apis/library) に移動
   - "Google+ API" を検索して有効化
   - 参考: [Google+ API ドキュメント](https://developers.google.com/+/web/api/rest/)

3. **OAuth 同意画面の設定**
   - [APIs & Services > OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) に移動
   - User Type: "External" を選択
   - アプリ名: "${AppName}"
   - ユーザーサポートメール: ${YOUR_EMAIL_ADDRESS}
   - 承認済みドメイン: ${YOUR_DOMAIN}（例: `example.com`）
   - 開発者の連絡先情報: ${YOUR_EMAIL_ADDRESS}

4. **OAuth 2.0 クライアント ID の作成**
   - [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials) に移動
   - "+ CREATE CREDENTIALS" > "OAuth client ID" をクリック
   - アプリケーションの種類: "Web application"
   - 名前: "${AppName} Web Client"
   - 承認済みの JavaScript 生成元:
     - `https://${YOUR_DOMAIN}` # 例: https://brw-dev.auth.us-east-1.amazoncognito.com
     - `https://${appName}-${stage}.auth.${AWS_REGION}.amazoncognito.com` # 例: https://brw-dev.auth.us-east-1.amazoncognito.com
   - 承認済みのリダイレクト URI:
     - `https://${appName}-${stage}.auth.${AWS_REGION}.amazoncognito.com/oauth2/idpresponse`
     - `https://${YOUR_DOMAIN}/callback`
   - "作成" をクリック

5. **クライアント ID とシークレットを取得**
   - 作成されたクライアント ID をクリック
   - "クライアント ID" と "クライアント シークレット" をコピー
   - これらの値を `.env` ファイルに設定

6. **データアクセススコープの設定**
   - [データアクセス](https://console.cloud.google.com/auth/scopes) をクリック
   - スコープを追加または削除 ボタンを押し、以下のスコープを追加する
     - 非機密のスコープ
       - /auth/userinfo.email
       - /auth/userinfo.profile
       - openid
     -  機密性の高いスコープ
       - なし
     -  制限付きのスコープ
       - なし

**参考ドキュメント:**
- [Google OAuth 2.0 設定ガイド](https://developers.google.com/identity/protocols/oauth2)
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)

#### 当アプリにおけるユーザー情報の管理範囲と方式

**アプリユーザーの管理**

当アプリでは、前述の Google OAuth 2.0 クライアントの設定と連携させる形で、AWS Cognito を使用してログインとログインユーザー情報を管理します。

具体的には、当アプリに `Googleでサインイン` したユーザーの情報が、 `lib/auth-backend-stack.ts` でデプロイされた AWS Cognito のユーザープールに保存され、当アプリ内のログインユーザー情報として利用されます。

同ユーザープール内のユーザーの一位識別子である `Cognito ユーザーの sub` 情報が、当アプリ内ではユーザーIDとして利用される仕様です。

このため、当アプリではユーザーのGoogle Accountの個人情報は一切取り扱わず、sub情報だけを扱います。

**Bluesky ユーザ情報の管理**

当アプリは、ユーザーが `Googleでサインイン` した後にアクセスできるマイページ (`/mypage`) から、BlueskyのユーザーID と アプリパスワード の登録を求めます。

アプリは、ユーザーが入力した両情報を使って Bluesky への接続を試み、成功した場合にのみJSON形式で `lib/params-resource-stack.ts` で作成される S3バケット `UserInfoBucket` へ、オブジェクト名 `${Cognito ユーザーの sub}.json` で保存されます。

**ユーザーコンテンツの管理**

ユーザーがマイページから投稿した画像と投稿メッセージは、Bluesky投稿と来歴証明の目的で、`lib/params-resource-stack.ts` で作成される S3バケット `ProvenanceInfoBucket`, `ProvenancePublicBucket` などへ保存されます。来歴ページはログインしていないユーザーにも来歴証明のため公開されるコンテンツです。

### 1. 依存関係のインストール

```bash
npm install
poetry install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` ファイルを編集:
```
APP_NAME=${AppName}
DOMAIN_NAME=${YOUR_DOMAIN}
HOSTED_ZONE_ID=Z1234567890ABC
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### 3. CDK Bootstrap（初回のみ）

```bash
npx cdk bootstrap # 初回のみ
```

## デプロイ

### 開発環境

```bash
# stage=dev を指定, または省略
npx cdk deploy --all --context stage=dev --require-approval never
```

### 本番環境

```bash
# stage=prd を指定
npx cdk deploy --all --context stage=prd --require-approval never
```

## アクセスURL

**重要**: このアプリケーションはCloudFrontカスタムドメイン経由でのアクセス専用に設計されています。API Gateway URLを直接使用しないでください。

デプロイ完了後、以下のカスタムドメインURLでアプリケーションにアクセスできます：

- **サービスホーム**: `https://${YOUR_DOMAIN}/`
- **サインアップ**: `https://${YOUR_DOMAIN}/signup`
- **ログイン**: `https://${YOUR_DOMAIN}/login`
- **マイページ**: `https://${YOUR_DOMAIN}/mypage`
- **透かし検証**: `https://${YOUR_DOMAIN}/verify-watermark`
- **認証エンドポイント**: `https://${AppName}-{stage}.auth.{region}.amazoncognito.com`

### 動作確認

https://${YOUR_DOMAIN}/

## アーキテクチャ

### 🏗️ インフラ構成
1. **共通スタック**: S3バケット、KMSキー、SSMパラメータ、Route53
2. **認証バックエンド**: Cognito（マネージドドメイン）、CloudFront、API Gateway、ACM証明書
3. **Webアプリ**: サインアップ、ログイン、マイページ（投稿機能付き）
4. **投稿処理ワークフロー**: SQS → Step Functions → Lambda群（TrustMark埋め込み、Bluesky投稿、来歴生成）

### 🌐 ドメイン構成
- **メインアプリ**: `https://${YOUR_DOMAIN}` （CloudFrontカスタムドメイン）
- **認証エンドポイント**: `https://${AppName}-{stage}.auth.{region}.amazoncognito.com` （Cognitoマネージドドメイン）
- **CloudFront**: API Gatewayをオリジンとして全パスをルーティング
- **重要**: CORS問題回避とセキュリティのため、必ずカスタムドメイン経由でアクセス

### 📊 データフロー
1. **ユーザー登録**: Google OAuth → Cognito → S3（ユーザー情報）
2. **投稿作成**: マイページ → S3（投稿データ） → SQS（処理キュー）
3. **投稿処理**: SQS → Step Functions → TrustMark埋め込み → Bluesky投稿
4. **来歴生成**: 来歴ページ生成 → ユーザー一覧ページ更新 → S3（公開）

## セキュリティ

### 🔒 データ保護
- **KMS暗号化**: Blueskyアプリパスワードの暗号化保存
- **認証検証**: `com.atproto.server.getSession` APIによる認証情報検証
- **最小権限**: IAMポリシーによる必要最小限のアクセス権限

### 🛡️ API セキュリティ
- **JWT認証**: CloudFrontでのAuthorizationヘッダー転送
- **CORS対策**: カスタムドメインによる統一アクセス
- **レート制限**: API Gatewayでの制限（実装予定）

### 🔐 画像取得
- **AT Protocol**: `com.atproto.sync.getBlob` APIによる安全な画像取得
- **PDS自動解決**: ユーザーDIDから適切なPDSを自動特定
- **認証不要**: 画像取得時の認証は不要（公開データ）

## 実装状況

### ✅ 完了済み機能
- Google OAuth 2.0認証（Cognitoマネージドドメイン対応）
- Bluesky連携（アプリパスワード認証・検証）
- マイページ投稿機能（テキスト・画像）
- Snowflake ID生成による投稿識別
- SQSを使用した投稿処理キュー
- Step Functions投稿処理ワークフロー（並列透かし処理）
- **TrustMark埋め込み**（EXIF/メタデータベース）
- **Spectrum Watermark埋め込み**（Snowflake ID + 堅牢な周波数領域透かし）
- **透かし検証API**（`/verify-watermark`エンドポイント）
- 来歴ページ自動生成（透かし情報表示）
- ユーザー一覧ページ自動更新

### 🚧 実装中・予定
- Spread Spectrum Watermarking バイナリのLambdaレイヤー構築
- 透かし検証のUI改善
- CloudWatch監視・アラート
- エラーハンドリング強化
- imagewmark統合（より高度な堅牢性が必要な場合）

## クリーンアップ

```bash
npx cdk destroy --all --context stage=dev
```
# bluesky-robust-watermarker
# bluesky-robust-watermarker
