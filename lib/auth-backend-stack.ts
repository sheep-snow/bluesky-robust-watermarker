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
  public readonly distribution: cloudfront.Distribution;
  public readonly api: apigateway.RestApi;

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

    // API Gateway
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${props.appName}-${props.stage}-api`,
      description: '${props.appName} API Gateway',
      binaryMediaTypes: ['image/*', 'multipart/form-data'],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key']
      }
      // 自動デプロイメントは有効のままにして、明示的なデプロイメントで上書き
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
          `https://${props.paramsResourceStack.domainName}/callback`
        ],
        logoutUrls: [
          `https://${props.paramsResourceStack.domainName}/logout`
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



    // S3用のキャッシュポリシー（静的コンテンツ用）
    const s3CachePolicy = new cloudfront.CachePolicy(this, 'S3CachePolicy', {
      cachePolicyName: `${props.appName}-s3-cache-policy`,
      comment: 'Cache policy for S3 static content',
      defaultTtl: cdk.Duration.hours(24),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.seconds(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none()
    });

    // S3バケット（静的ファイル用）
    const staticFilesBucket = new s3.Bucket(this, 'StaticFilesBucket', {
      bucketName: `${props.appName}-${props.stage}-static-files`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // 静的ファイル（favicon.ico、CSS）をS3にデプロイ
    new s3deploy.BucketDeployment(this, 'DeployStaticFiles', {
      sources: [
        s3deploy.Source.asset('./static', {
          exclude: ['tailwind.css'] // ビルド前のファイルは除外
        })
      ],
      destinationBucket: staticFilesBucket
    });

    // CloudFront Distribution (API Gateway + S3 Origins)
    const apiOrigin = new origins.RestApiOrigin(this.api);
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(staticFilesBucket);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: apiOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy: cachePolicy,
        originRequestPolicy: originRequestPolicy
      },
      additionalBehaviors: {
        '/mypage/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cachePolicy,
          originRequestPolicy: originRequestPolicy
        },
        '/signup': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cachePolicy,
          originRequestPolicy: originRequestPolicy
        },
        '/login': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cachePolicy,
          originRequestPolicy: originRequestPolicy
        },
        '/callback': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cachePolicy,
          originRequestPolicy: originRequestPolicy
        },
        // Public watermark verification (no auth required)
        '/verify-watermark': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cachePolicy,
          originRequestPolicy: originRequestPolicy
        },
        // Favicon (S3経由)
        'favicon.ico': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: s3CachePolicy
        },
        // CSSファイル (S3経由)
        '*.css': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: s3CachePolicy
        },
        // User list pages (S3オリジン)
        'users/*': {
          origin: new origins.S3Origin(props.paramsResourceStack.provenancePublicBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: s3CachePolicy
        },
        // Provenance pages (S3オリジン) - 投稿IDのパスパターン
        'provenance/*': {
          origin: new origins.S3Origin(props.paramsResourceStack.provenancePublicBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: s3CachePolicy,
          // ディレクトリパスでのアクセス時にindex.htmlを自動追加するFunction
          functionAssociations: [{
            function: new cloudfront.Function(this, 'IndexRewriteFunction', {
              functionName: `${props.appName}-${props.stage}-index-rewrite`,
              code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    // URIが/で終わる場合、index.htmlを追加
    if (uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    // URIがディレクトリ名のみの場合（拡張子なし）、/index.htmlを追加  
    else if (!uri.includes('.')) {
        request.uri += '/index.html';
    }
    
    return request;
}
              `),
              comment: 'Rewrite directory requests to index.html'
            }),
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST
          }]
        }
      },
      domainNames: [props.paramsResourceStack.domainName],
      certificate: this.certificate
    });

    // Route53 A record for CloudFront distribution
    new route53.ARecord(this, 'AliasRecord', {
      zone: props.paramsResourceStack.hostedZone,
      recordName: props.paramsResourceStack.domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution))
    });

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

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: `https://${this.api.restApiId}.execute-api.${this.region}.amazonaws.com/prod/`,
      exportName: `${props.appName}-${props.stage}-api-gateway-url`
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distribution.distributionDomainName,
      exportName: `${props.appName}-${props.stage}-cloudfront-domain-name`
    });

    new cdk.CfnOutput(this, 'ApiGatewayId', {
      value: this.api.restApiId,
      exportName: `${props.appName}-${props.stage}-api-gateway-id`
    });

    new cdk.CfnOutput(this, 'ApiGatewayRootResourceId', {
      value: this.api.restApiRootResourceId,
      exportName: `${props.appName}-${props.stage}-api-gateway-root-resource-id`
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: `${props.appName}-${props.stage}-distribution-id`
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