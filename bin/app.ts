#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import 'dotenv/config';
import { ApiStack } from '../lib/api-stack';
import { AuthBackendStack } from '../lib/auth-backend-stack';
import { BatchStack } from '../lib/batch-stack';
import { DatabaseStack } from '../lib/database-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { ParamsResourceStack } from '../lib/params-resource-stack';

const app = new cdk.App();
const stage = app.node.tryGetContext('stage') || 'dev';
const appName = process.env.APP_NAME || 'brw';
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

// 2. データベーススタック
const databaseStack = new DatabaseStack(app, `${appName}-${stage}-database`, {
  env,
  stage,
  appName
});
databaseStack.addDependency(paramsResourceStack);

// 3. API専用スタック
const apiStack = new ApiStack(app, `${appName}-${stage}-api`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
apiStack.addDependency(paramsResourceStack);

// 4. 認証認可・公開バックエンド機能
const authBackendStack = new AuthBackendStack(app, `${appName}-${stage}-auth-backend`, {
  env,
  stage,
  appName,
  paramsResourceStack
});
authBackendStack.addDependency(paramsResourceStack);

// 5. 投稿処理ワークフロー機能
const batchStack = new BatchStack(app, `${appName}-${stage}-batch`, {
  env,
  stage,
  appName,
  paramsResourceStack,
  databaseStack
});
batchStack.addDependency(databaseStack);

// 6. フロントエンドスタック
const frontendStack = new FrontendStack(app, `${appName}-${stage}-frontend`, {
  env,
  stage,
  appName,
  paramsResourceStack,
  apiUrl: apiStack.api.url,
  domainName: process.env.DOMAIN_NAME,
  hostedZoneId: process.env.HOSTED_ZONE_ID
});
frontendStack.addDependency(apiStack);