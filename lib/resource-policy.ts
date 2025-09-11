import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

/**
 * アプリケーション共通のリソース管理ポリシー
 */
export class ResourcePolicy {
  /**
   * 開発環境用の削除ポリシー
   */
  static readonly REMOVAL_POLICY = cdk.RemovalPolicy.DESTROY;

  /**
   * ログ保持期間（開発環境: 1週間、本番環境: 30日）
   */
  static getLogRetention(stage: string): logs.RetentionDays {
    return logs.RetentionDays.ONE_MONTH;
  }

  /**
   * Lambda用のLogGroupを作成（destroy時に削除されることを保証）
   */
  static createLambdaLogGroup(scope: Construct, id: string, functionName: string, stage: string): logs.LogGroup {
    // ランダムなpostfixを生成
    const uniqueId = this.generateUniqueId();
    const logGroupName = `/aws/lambda/${functionName}-${uniqueId}`;
    const logGroup = new logs.LogGroup(scope, id, {
      logGroupName,
      retention: this.getLogRetention(stage),
      removalPolicy: this.REMOVAL_POLICY,
    });

    // カスタムリソースでログループの削除を確実に実行
    const deleteLogGroupRole = new iam.Role(scope, `${id}DeleteRole`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        LogsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:DeleteLogGroup'
              ],
              resources: [`arn:aws:logs:*:*:log-group:${logGroupName}*`]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:DescribeLogGroups'
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    new cr.AwsCustomResource(scope, `${id}DeleteCustomResource`, {
      onCreate: {
        service: 'CloudWatchLogs',
        action: 'describeLogGroups',
        parameters: {
          logGroupNamePrefix: logGroupName
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${functionName}-log-group-manager-${uniqueId}`)
      },
      onDelete: {
        service: 'CloudWatchLogs',
        action: 'deleteLogGroup',
        parameters: {
          logGroupName: logGroupName
        },
        ignoreErrorCodesMatching: 'ResourceNotFoundException'
      },
      role: deleteLogGroupRole,
      logRetention: logs.RetentionDays.ONE_MONTH
    });

    return logGroup;
  }

  /**
   * リソース名にタイムスタンプを追加してユニーク性を保証
   */
  static generateUniqueId(): string {
    return Date.now().toString(36);
  }

  /**
   * Lambda関数の共通設定（logRetentionを削除してlogGroupを使用）
   */
  static getLambdaDefaults(stage: string) {
    return {
      runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      bundling: {
        externalModules: ['@aws-sdk/*'],
        forceDockerBundling: true,
        // キャッシュ無効化のためのタイムスタンプ
        commandHooks: {
          beforeBundling: () => [],
          afterBundling: () => [],
          beforeInstall: () => []
        }
      }
    };
  }

  /**
   * S3バケットの共通設定
   */
  static getS3BucketDefaults() {
    return {
      removalPolicy: this.REMOVAL_POLICY,
      autoDeleteObjects: true
    };
  }

  /**
   * CloudFormationスタックの共通タグ
   */
  static getCommonTags(appName: string, stage: string) {
    return {
      Project: appName,
      Stage: stage,
      ManagedBy: 'CDK'
    };
  }

  /**
   * リソース名の標準化
   */
  static getResourceName(appName: string, stage: string, resourceType: string, suffix?: string): string {
    const parts = [appName, stage, resourceType];
    if (suffix) parts.push(suffix);
    return parts.join('-');
  }


}