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
- Python 3.12.x
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
     - 機密性の高いスコープ
       - なし
     - 制限付きのスコープ
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
# または個別にスタックを指定してデプロイ
npx cdk deploy ${AppName}-dev-batch --context stage=dev --require-approval never
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

