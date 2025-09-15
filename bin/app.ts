#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import 'dotenv/config';
import { AuthBackendStack } from '../lib/auth-backend-stack';
import { BatchStack } from '../lib/batch-stack';
import { HomeStack } from '../lib/home-stack';
import { LoginStack } from '../lib/login-stack';
import { MyPageStack } from '../lib/mypage-stack';
import { ParamsResourceStack } from '../lib/params-resource-stack';
import { SignupStack } from '../lib/signup-stack';
import { VerifyStack } from '../lib/verify-stack';
import { VerifyWatermarkStack } from '../lib/verify-watermark-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';


const app = new cdk.App();
const stage = app.node.tryGetContext('stage') || 'dev';
const appName = process.env.APP_NAME || 'brw';
const domainName = process.env.DOMAIN_NAME!;
const hostedZoneId = process.env.HOSTED_ZONE_ID!;
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1'
};

// 1. 共通スタック（最初にデプロイ）
const paramsResourceStack = new ParamsResourceStack(app, `${appName}-${stage}-params-resource`, {
  env,
  stage,
  appName
});

// 2. 認証認可・公開バックエンド機能
const authBackendStack = new AuthBackendStack(app, `${appName}-${stage}-auth-backend`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
authBackendStack.addDependency(paramsResourceStack);

// 2.5. ホームページ機能
const homeStack = new HomeStack(app, `${appName}-${stage}-home`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
homeStack.addDependency(authBackendStack);

// 3. サインアップ機能
const signupStack = new SignupStack(app, `${appName}-${stage}-signup`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
signupStack.addDependency(authBackendStack);

// 4. ログイン機能
const loginStack = new LoginStack(app, `${appName}-${stage}-login`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
loginStack.addDependency(authBackendStack);

// 5. 透かし検証機能
const verifyStack = new VerifyStack(app, `${appName}-${stage}-verify`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
verifyStack.addDependency(authBackendStack);

// 5.5. 透かし検証機能（追加）
const verifyWatermarkStack = new VerifyWatermarkStack(app, `${appName}-${stage}-verify-watermark`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
verifyWatermarkStack.addDependency(authBackendStack);

// 6. マイページ機能（認証必須）
const myPageStack = new MyPageStack(app, `${appName}-${stage}-mypage`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
myPageStack.addDependency(authBackendStack);

// 6. 投稿処理ワークフロー機能
const batchStack = new BatchStack(app, `${appName}-${stage}-batch`, {
  env,
  stage,
  appName,
  paramsResourceStack,
  myPageStack
});
batchStack.addDependency(myPageStack);

// 7. 新しいAPI スタック
const apiStack = new ApiStack(app, `${appName}-${stage}-api`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
apiStack.addDependency(authBackendStack);

// 8. 新しいフロントエンドスタック
const frontendStack = new FrontendStack(app, `${appName}-${stage}-frontend`, {
  env,
  stage,
  appName,
  paramsResourceStack,
  apiGatewayUrl: apiStack.api.url,
  domainName,
  hostedZoneId
});
frontendStack.addDependency(apiStack);

// スタック間の依存関係:
// 1. paramsResourceStack (基盤)
// 2. authBackendStack (認証)
// 3. signupStack, loginStack, verifyStack (旧公開Webアプリ)
// 4. myPageStack (旧認証が必要なWebアプリ)
// 5. batchStack (投稿処理ワークフロー)
// 6. apiStack (新API)
// 7. frontendStack (新フロントエンド)