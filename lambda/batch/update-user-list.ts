import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { wrapWithLayout } from '../common/ui-framework';

const APP_NAME = process.env.APP_NAME || 'brw';
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const cloudFrontClient = new CloudFrontClient({ region: process.env.AWS_REGION || 'us-east-1' });

export const handler = async (event: any) => {
  console.log('Update user list event:', JSON.stringify(event, null, 2));

  const { postId, userId, provenanceUrl } = event;

  try {
    // Get user info
    const userCommand = new GetObjectCommand({
      Bucket: process.env.USER_INFO_BUCKET,
      Key: `${userId}.json`
    });
    const userResult = await s3Client.send(userCommand);
    const userInfo = JSON.parse(await userResult.Body!.transformToString());

    // Get all provenance pages for this user
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
      Prefix: 'provenance/',
      Delimiter: '/'
    });
    const listResult = await s3Client.send(listCommand);

    const userPosts = [];
    if (listResult.CommonPrefixes) {
      for (const prefix of listResult.CommonPrefixes) {
        const postIdFromPrefix = prefix.Prefix?.replace('provenance/', '').replace('/', '');
        if (postIdFromPrefix) {
          // Check if this post belongs to the current user
          try {
            const postDataCommand = new GetObjectCommand({
              Bucket: process.env.POST_DATA_BUCKET,
              Key: `${postIdFromPrefix}/post.json`
            });
            const postDataResult = await s3Client.send(postDataCommand);
            const postData = JSON.parse(await postDataResult.Body!.transformToString());

            if (postData.userId === userId) {
              const hasImages = (postData.imageMetadata && postData.imageMetadata.length > 0) || postData.image;
              const imageCount = postData.imageMetadata ? postData.imageMetadata.length : (postData.image ? 1 : 0);
              
              userPosts.push({
                postId: postIdFromPrefix,
                createdAt: postData.createdAt,
                text: postData.text || '',
                hasImages: hasImages,
                imageCount: imageCount,
                provenanceUrl: `/provenance/${postIdFromPrefix}/`
              });
            }
          } catch (error) {
            // Skip if post data not found
            console.log(`Post data not found for ${postIdFromPrefix}`);
          }
        }
      }
    }

    // Sort posts by creation date (newest first)
    userPosts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Generate user list page content
    const content = `
      <div class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
        <div class="hero-content text-center py-12">
          <div class="max-w-md">
            <h1 class="mb-5 text-4xl font-bold">📄 Provenance List</h1>
            <h2 class="mb-5 text-2xl font-bold">${userInfo.blueskyUserId}</h2>
            <p class="mb-5 text-lg">来歴の一覧</p>
            <div class="flex gap-4 justify-center">
              <a href="/mypage" class="btn btn-soft btn-primary">← Back to My Page</a>
            </div>
          </div>
        </div>
      </div>
    
      ${userPosts.length > 0 ? userPosts.map(post => `
      <div class="card bg-base-100 shadow-xl mb-6">
        <div class="card-body">
          <h3 class="card-title text-primary">📋 Post ${post.postId}</h3>
          <div class="flex flex-wrap gap-2 mb-4">
            <div class="badge badge-soft">Created: ${new Date(post.createdAt).toLocaleString()}</div>
            <div class="badge badge-secondary">ID: ${post.postId}</div>
            ${post.hasImages ? `<div class="badge badge-accent">${post.imageCount} image${post.imageCount > 1 ? 's' : ''}</div>` : ''}
          </div>
          ${post.text ? `
          <div class="card bg-base-200 p-4 mb-4">
            <p class="text-base-content">${post.text}</p>
          </div>
          ` : ''}
          <div class="card-actions justify-end">
            <a href="${post.provenanceUrl}" class="btn btn-primary">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              来歴ページ
            </a>
          </div>
        </div>
      </div>
      `).join('') : `
      <div class="hero min-h-64 bg-base-100 rounded-lg">
        <div class="hero-content text-center">
          <div class="max-w-md">
            <div class="text-6xl mb-4">🔍</div>
            <h3 class="text-xl font-bold mb-4">No Verified Posts Found</h3>
            <p class="text-base-content/70">No verified posts found for this user yet. Start creating posts with provenance tracking!</p>
            <div class="mt-6">
              <a href="/mypage" class="btn btn-primary">Create Your First Post</a>
            </div>
          </div>
        </div>
      </div>
      `}
    
      <div class="stats stats-vertical lg:stats-horizontal shadow mb-8 bg-base-100">
        <div class="stat">
          <div class="stat-figure text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
          </div>
          <div class="stat-title">来歴数</div>
          <div class="stat-value text-primary">${userPosts.length}</div>
        </div>
        <div class="stat">
          <div class="stat-figure text-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"></path></svg>
          </div>
          <div class="stat-title">Last Updated</div>
          <div class="stat-value text-secondary text-lg">${new Date().toLocaleDateString()}</div>
          <div class="stat-desc">${new Date().toLocaleTimeString()}</div>
        </div>
      </div>
            
      <script>
        // Check authentication status and update UI
        function checkAuthAndUpdateUI() {
          const accessToken = localStorage.getItem('access_token');
          const idToken = localStorage.getItem('id_token');
          const isAuthenticated = accessToken && idToken;
          
          if (isAuthenticated) {
            // Hide signup/login elements
            const navSignup = document.querySelector('a[href="/signup"]');
            const navLogin = document.querySelector('a[href="/login"]');
            if (navSignup) navSignup.style.display = 'none';
            if (navLogin) navLogin.style.display = 'none';
          }
        }
        
        function logout() {
          localStorage.removeItem('access_token');
          localStorage.removeItem('id_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/';
        }
        
        // Initialize auth UI on page load
        document.addEventListener('DOMContentLoaded', checkAuthAndUpdateUI);
      </script>
    `;

    const listPageHtml = wrapWithLayout(`${APP_NAME} - ${userInfo.blueskyUserId} Provenance List`, content, 'provenance-list');

    // Save user list page
    const listPageCommand = new PutObjectCommand({
      Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
      Key: `users/${userInfo.provenancePageId}.html`,
      Body: listPageHtml,
      ContentType: 'text/html'
    });
    await s3Client.send(listPageCommand);

    // Invalidate CloudFront cache for the updated user list page
    if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
      try {
        const invalidationCommand = new CreateInvalidationCommand({
          DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
          InvalidationBatch: {
            Paths: {
              Quantity: 1,
              Items: [`/users/${userInfo.provenancePageId}.html`]
            },
            CallerReference: `user-list-update-${Date.now()}`
          }
        });
        await cloudFrontClient.send(invalidationCommand);
        console.log(`CloudFront cache invalidated for /users/${userInfo.provenancePageId}.html`);
      } catch (invalidationError) {
        console.error('CloudFront invalidation failed:', invalidationError);
        // Don't throw error, just log it since cache invalidation is not critical
      }
    }

    const userListUrl = `/users/${userInfo.provenancePageId}.html`;

    return {
      ...event,
      userListUrl,
      userListUpdated: true,
      totalPosts: userPosts.length
    };

  } catch (error) {
    console.error('User list update failed:', error);
    throw error;
  }
};