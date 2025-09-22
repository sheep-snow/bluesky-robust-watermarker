import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

export interface ParamsResourceStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
}

export class ParamsResourceStack extends cdk.Stack {
  public readonly userInfoBucket: s3.Bucket;
  public readonly provenanceInfoBucket: s3.Bucket;
  public readonly provenancePublicBucket: s3.Bucket;
  public readonly hostedZone: route53.IHostedZone;
  public readonly domainName: string;
  public readonly googleClientId: string;
  public readonly googleClientSecret: string;

  public readonly stage: string;
  public readonly kmsKey: kms.Key;

  constructor(scope: Construct, id: string, props: ParamsResourceStackProps) {
    super(scope, id, props);

    this.stage = props.stage;

    // 環境変数の読み込み
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('='); // '='が値に含まれる場合の対応
            process.env[key.trim()] = value.trim();
          }
        }
      });
    }

    this.domainName = process.env.DOMAIN_NAME || 'example.com';
    this.googleClientId = process.env.GOOGLE_CLIENT_ID || '';
    this.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';


    // Route53 HostedZone の参照
    this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: process.env.HOSTED_ZONE_ID || '',
      zoneName: this.domainName
    });

    // KMSキー（Blueskyパスワード暗号化用）
    this.kmsKey = new kms.Key(this, 'BlueskyPasswordKey', {
      alias: `${props.appName}-${props.stage}-bluesky-password-key`,
      description: 'KMS key for encrypting Bluesky app passwords',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // S3バケット: ユーザー情報
    this.userInfoBucket = new s3.Bucket(this, 'UserInfoBucket', {
      bucketName: `${props.appName}-userinfobucket-${props.stage}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED
    });

    // S3バケット: 来歴情報保管
    this.provenanceInfoBucket = new s3.Bucket(this, 'ProvenanceInfoBucket', {
      bucketName: `${props.appName}-provenanceinfobucket-${props.stage}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED
    });

    // S3バケット: 来歴情報公開（CloudFrontからのアクセスのみ）
    this.provenancePublicBucket = new s3.Bucket(this, 'ProvenancePublicBucket', {
      bucketName: `${props.appName}-provenancepublicbucket-${props.stage}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      // CloudFrontのOAC経由でのみアクセス許可
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    // favicon.icoをS3バケットにデプロイ
    new s3deploy.BucketDeployment(this, 'FaviconDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../'), {
        exclude: ['*', '!favicon.ico']  // favicon.ico のみを含める
      })],
      destinationBucket: this.provenancePublicBucket,
      prune: false  // 他のファイルを削除しない
    });

    // CloudFront OAC用のS3バケットポリシーは後でauth-backend-stackから設定

    // SSMパラメータとして共有値を保存
    new ssm.StringParameter(this, 'DomainNameParam', {
      parameterName: `/${props.appName}/${props.stage}/domain-name`,
      stringValue: this.domainName
    });

    // Google OAuth パラメータ（値が設定されている場合のみ作成）
    if (this.googleClientId && this.googleClientId.trim() !== '') {
      new ssm.StringParameter(this, 'GoogleClientIdParam', {
        parameterName: `/${props.appName}/${props.stage}/google-client-id`,
        stringValue: this.googleClientId
      });
    }

    if (this.googleClientSecret && this.googleClientSecret.trim() !== '') {
      new ssm.StringParameter(this, 'GoogleClientSecretParam', {
        parameterName: `/${props.appName}/${props.stage}/google-client-secret`,
        stringValue: this.googleClientSecret
      });
    }

    new ssm.StringParameter(this, 'KmsKeyIdParam', {
      parameterName: `/${props.appName}/${props.stage}/kms-key-id`,
      stringValue: this.kmsKey.keyId
    });

    // 出力
    new cdk.CfnOutput(this, 'UserInfoBucketName', {
      value: this.userInfoBucket.bucketName,
      exportName: `${props.appName}-${props.stage}-user-info-bucket-name`
    });

    new cdk.CfnOutput(this, 'ProvenanceInfoBucketName', {
      value: this.provenanceInfoBucket.bucketName,
      exportName: `${props.appName}-${props.stage}-provenance-info-bucket-name`
    });

    new cdk.CfnOutput(this, 'ProvenancePublicBucketName', {
      value: this.provenancePublicBucket.bucketName,
      exportName: `${props.appName}-${props.stage}-provenance-public-bucket-name`
    });

    new cdk.CfnOutput(this, 'KmsKeyId', {
      value: this.kmsKey.keyId,
      exportName: `${props.appName}-${props.stage}-kms-key-id`
    });

    new cdk.CfnOutput(this, 'ProvenancePublicBucketArn', {
      value: this.provenancePublicBucket.bucketArn,
      exportName: `${props.appName}-${props.stage}-provenance-public-bucket-arn`
    });
  }
}