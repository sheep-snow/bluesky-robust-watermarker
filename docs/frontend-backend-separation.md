# フロントエンドとバックエンド分離計画

## 現在の課題
- Lambda関数内にHTMLが混在
- サーバーサイドレンダリング（SSR）でパフォーマンスが劣る
- フロントエンドとバックエンドが密結合
- CDNキャッシュの恩恵を受けにくい

## 新アーキテクチャ
- Astro + 静的サイト生成
- Lambda API専用化
- CDK構成変更

## Phase 1: APIの分離
- 既存Lambda関数からHTML部分を削除
- JSON APIレスポンスのみに変更
- `/api/`プレフィックスでAPI Gateway設定

## Phase 2: Astroプロジェクト作成
- `npm create astro@latest frontend`
- 既存HTMLをAstroコンポーネントに変換
- API呼び出しをクライアントサイドJavaScriptに移行

## Phase 3: デプロイメント統合
- Astroビルド出力をS3にデプロイ ✅
- CloudFront設定でAPI Gateway統合 ✅
- 移行とテスト ✅

## 実装順序
1. API専用Lambda関数作成 ✅
2. CDK構成更新（API Gateway） ✅
3. Astroプロジェクト初期化 ✅
4. 静的サイト配信設定（S3 + CloudFront） ✅
5. 段階的移行とテスト ✅

## 完了した機能
- Home, Login, Signup ページの分離完了
- API エンドポイント: https://3hmxz7blc5.execute-api.us-east-1.amazonaws.com/prod/
- フロントエンド URL: https://d3mdgfjk9kn6s7.cloudfront.net
- 静的サイト + API プロキシ統合完了

## 残りのタスク
- MyPage API専用化
- Verify-Watermark API専用化
- 認証フローの完全移行