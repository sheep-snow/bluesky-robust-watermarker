import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';

export interface AuthBackendStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
}

export class AuthBackendStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly certificate: acm.Certificate;


  constructor(scope: Construct, id: string, props: AuthBackendStackProps) {
    super(scope, id, props);

    // ACM証明書の作成（CloudFront用にus-east-1で作成）
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.paramsResourceStack.domainName,
      subjectAlternativeNames: [`*.${props.paramsResourceStack.domainName}`],
      validation: acm.CertificateValidation.fromDns(props.paramsResourceStack.hostedZone),
      certificateName: `${props.appName}-${props.stage}-certificate`
    });

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.appName}-${props.stage}-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: {
        username: true,
        email: true
      },
      autoVerify: {
        email: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Google Identity Provider
    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool: this.userPool,
      clientId: props.paramsResourceStack.googleClientId,
      clientSecretValue: cdk.SecretValue.unsafePlainText(props.paramsResourceStack.googleClientSecret),
      scopes: ['email', 'openid'],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL
      }
    });



    // User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `${props.appName}-${props.stage}-client`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID
        ],
        callbackUrls: [
          `https://${props.paramsResourceStack.domainName}/callback/`
        ],
        logoutUrls: [
          `https://${props.paramsResourceStack.domainName}/logout/`
        ]
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE
      ]
    });

    this.userPoolClient.node.addDependency(googleProvider);

    // User Pool Domain (Cognito Managed Domain)
    const userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: `${props.appName}-${props.stage}`
      }
    });

    // 管理OriginRequestPolicyを使用
    const originRequestPolicy = cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER;

    // 管理CachePolicyを使用（キャッシュ無効）
    const cachePolicy = cloudfront.CachePolicy.CACHING_DISABLED;







    // デプロイメントとステージは ApiDeploymentStack で統一管理
    // （循環依分を回避するため）



    // 出力
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${props.appName}-${props.stage}-user-pool-id`
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${props.appName}-${props.stage}-user-pool-client-id`
    });



    // Route53 A Record (temporarily disabled for initial deployment)
    // new route53.ARecord(this, 'AliasRecord', {
    //   zone: props.paramsResourceStack.hostedZone,
    //   target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution))
    // });

    // Output Cognito Domain URL
    new cdk.CfnOutput(this, 'CognitoDomainUrl', {
      value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
      exportName: `${props.appName}-${props.stage}-cognito-domain-url`
    });
  }
}