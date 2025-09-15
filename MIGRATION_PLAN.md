# 静的・動的コンテンツ分離 移行計画

## 現在の構成
- 全ページがLambdaで動的生成
- 各ページごとに個別のCDKスタック
- UI変更でもLambdaデプロイが必要

## 新しい構成
- 静的コンテンツ: Astro + S3 + CloudFront
- 動的コンテンツ: API Gateway + Lambda

## 移行手順

### Phase 1: 基盤準備 ✅
- [x] frontend/ ディレクトリ作成
- [x] Astro プロジェクト設定
- [x] 新しいCDKスタック設計

### Phase 2: 静的ページ移行
1. **ホームページ移行**
   ```bash
   # 既存のLambdaコードからAstroコンポーネントに変換
   cp lambda/home/index.ts → frontend/src/pages/index.astro
   ```

2. **共通コンポーネント作成**
   ```bash
   # UI frameworkからAstroコンポーネントに変換
   lambda/common/ui-framework.ts → frontend/src/layouts/Layout.astro
   ```

3. **各ページ順次移行**
   - signup → frontend/src/pages/signup.astro
   - login → frontend/src/pages/login.astro
   - verify-watermark → frontend/src/pages/verify-watermark.astro

### Phase 3: 動的API分離
1. **認証API**
   ```bash
   lambda/login/callback.ts → lambda/api/auth/callback.ts
   ```

2. **マイページAPI**
   ```bash
   lambda/mypage/index.ts → lambda/api/mypage/config.ts
   ```

3. **検証API**
   ```bash
   lambda/verify_watermark/ → lambda/api/verify/watermark.ts
   ```

### Phase 4: デプロイ戦略
1. **並行運用期間**
   - 新旧両方のスタックを並行デプロイ
   - CloudFrontで段階的にトラフィック切り替え

2. **完全移行**
   - 旧Lambdaスタック削除
   - DNS切り替え

## 利点
- **開発効率**: フロントエンド変更でLambdaデプロイ不要
- **パフォーマンス**: CloudFrontキャッシュ活用
- **コスト削減**: 静的コンテンツのLambda実行コスト削減
- **スケーラビリティ**: CDN配信による高速化

## 注意点
- **認証状態管理**: クライアントサイドでの認証状態管理が必要
- **SEO**: 静的生成によるSEO改善
- **API設計**: RESTful APIの適切な設計が重要