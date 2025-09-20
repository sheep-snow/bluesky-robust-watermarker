import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const APP_NAME = process.env.APP_NAME || 'btw';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const response = {
    appName: APP_NAME,
    title: `${APP_NAME} - Sign Up`,
    cognitoDomain: process.env.COGNITO_DOMAIN,
    clientId: process.env.USER_POOL_CLIENT_ID,
    domainName: process.env.DOMAIN_NAME,
    signupUrl: `${process.env.COGNITO_DOMAIN}/oauth2/authorize?client_id=${process.env.USER_POOL_CLIENT_ID}&response_type=code&scope=email+openid&redirect_uri=https://${process.env.DOMAIN_NAME}/callback`,
    links: {
      login: '/login',
      home: '/'
    }
  };

  return { statusCode: 200, headers, body: JSON.stringify(response) };
};