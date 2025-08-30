import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export interface ApiDeploymentStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
}

export class ApiDeploymentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiDeploymentStackProps) {
    super(scope, id, props);

    // API Gateway IDをインポート
    const apiId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`);

    // 全ての機能スタックがデプロイされた後に実行される統一デプロイメント
    const finalDeployment = new apigateway.CfnDeployment(this, 'FinalApiDeployment', {
      restApiId: apiId,
      description: `Final deployment with all endpoints - ${new Date().toISOString()}`
    });

    // prodステージを作成/更新
    const prodStage = new apigateway.CfnStage(this, 'ProdStage', {
      restApiId: apiId,
      deploymentId: finalDeployment.ref,
      stageName: 'prod',
      description: 'Production stage with all API endpoints'
    });

    // 出力
    new cdk.CfnOutput(this, 'DeploymentStatus', {
      value: 'All API Gateway endpoints deployed successfully to prod stage',
      exportName: `${props.appName}-${props.stage}-deployment-status`
    });

    new cdk.CfnOutput(this, 'ProdStageUrl', {
      value: `https://${apiId}.execute-api.us-east-1.amazonaws.com/prod/`,
      exportName: `${props.appName}-${props.stage}-prod-stage-url`
    });
  }
}
