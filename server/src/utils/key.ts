import { createHash } from 'crypto';
import { Context } from 'koa';

export const generateCacheKey = (context: Context) => {
  const { url } = context.request;
  const { method } = context.request;
  const query = context.request.query;
  const headers = context.request.headers;

  // Create a more robust cache key that includes query parameters and relevant headers
  const queryString = Object.keys(query).length > 0 ? JSON.stringify(query) : '';
  const relevantHeaders = {
    'accept-language': headers['accept-language'],
    'accept': headers['accept'],
    'user-agent': headers['user-agent'],
  };
  const headersString = JSON.stringify(relevantHeaders);

  const keyData = `${method}:${url}:${queryString}:${headersString}`;
  const hash = createHash('sha256').update(keyData).digest('base64url');
  
  return `cache:${hash}`;
};

export const generateGraphqlCacheKey = (payload: string) => {
  // Sanitize the payload to remove any sensitive information
  const sanitizedPayload = payload.replace(/"password":\s*"[^"]*"/g, '"password":"***"');
  const hash = createHash('sha256').update(sanitizedPayload).digest('base64url');
  return `graphql:${hash}`;
};
