import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

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
              userPosts.push({
                postId: postIdFromPrefix,
                createdAt: postData.createdAt,
                text: postData.text || '',
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

    // Generate user list page HTML
    const listPageHtml = `
<!DOCTYPE html>
<html data-theme="cupcake">
<head>
    <title>${APP_NAME} - ${userInfo.blueskyUserId} Provenance List</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    
    <link href="/tailwind.min.css" rel="stylesheet" type="text/css" />
    <script>
      function initTheme() {
        const savedTheme = localStorage.getItem('${APP_NAME.toLowerCase()}-theme') || 'cupcake';
        document.documentElement.setAttribute('data-theme', savedTheme);
      }
      function changeTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('${APP_NAME.toLowerCase()}-theme', theme);
      }
      document.addEventListener('DOMContentLoaded', initTheme);
    </script>
</head>
<body class="min-h-screen flex flex-col bg-base-200">
    <div class="navbar bg-base-100 shadow-lg">
      <div class="navbar-start">
        <a href="/" class="btn btn-ghost text-xl">📄 ${APP_NAME}</a>
      </div>
      <div class="navbar-center hidden lg:flex">
        <ul class="menu menu-horizontal px-1">
          <li><a href="/">Home</a></li>
          <li><a href="/signup" id="nav-signup">Sign Up</a></li>
          <li><a href="/login" id="nav-login">Login</a></li>
          <li><a href="/mypage" id="nav-mypage">My Page</a></li>
          <li><a href="/users/${userInfo.provenancePageId}.html" class="active">Provenance List</a></li>
        </ul>
      </div>
      <div class="navbar-end">
        <div class="hidden" id="auth-actions">
          <button onclick="logout()" class="btn btn-error btn-sm mr-2">Logout</button>
        </div>
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-ghost">
            Theme
            <svg width="12px" height="12px" class="h-2 w-2 fill-current opacity-60 inline-block" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048"><path d="m1799 349 242 241-1017 1017L7 590l242-241 775 775 775-775z"></path></svg>
          </div>
          <ul tabindex="0" class="dropdown-content z-[1] p-2 shadow-2xl bg-base-300 rounded-box w-52">
            <li><input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Cupcake" value="cupcake" onclick="changeTheme('cupcake')"/></li>
            <li><input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Dark" value="dark" onclick="changeTheme('dark')"/></li>
            <li><input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Emerald" value="emerald" onclick="changeTheme('emerald')"/></li>
            <li><input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Corporate" value="corporate" onclick="changeTheme('corporate')"/></li>
          </ul>
        </div>
      </div>
    </div>
    
    <div class="container mx-auto px-4 py-8 flex-1">
      <div class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
        <div class="hero-content text-center py-12">
          <div class="max-w-md">
            <h1 class="mb-5 text-4xl font-bold">📄 Provenance List</h1>
            <h2 class="mb-5 text-2xl font-bold">${userInfo.blueskyUserId}</h2>
            <p class="mb-5 text-lg">Verified image provenance records</p>
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
              View Provenance Details
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
          <div class="stat-title">Total Verified Posts</div>
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
    </div>
    
    <div class="text-center py-8 bg-base-300">
      <p class="text-base-content">This page was generated by ${APP_NAME} to list all verified provenance records for this user.</p>
    </div>
    
    <footer class="footer footer-center p-10 bg-base-200 text-base-content rounded">
      <div>
        <a href="/" class="btn btn-ghost"> ${APP_NAME} Home</a>
        <p class="mt-2">Copyright © 2025 - All right reserved by ${APP_NAME}</p>
      </div>
    </footer>
    
    <script>
      // Check authentication status and update UI
      function checkAuthAndUpdateUI() {
        const accessToken = localStorage.getItem('access_token');
        const idToken = localStorage.getItem('id_token');
        const isAuthenticated = accessToken && idToken;
        
        if (isAuthenticated) {
          // Hide signup/login elements
          document.getElementById('nav-signup').style.display = 'none';
          document.getElementById('nav-login').style.display = 'none';
          
          // Show authenticated elements
          document.getElementById('auth-actions').classList.remove('hidden');
        } else {
          // Show signup/login elements
          document.getElementById('nav-signup').style.display = 'block';
          document.getElementById('nav-login').style.display = 'block';
          
          // Hide authenticated elements
          document.getElementById('auth-actions').classList.add('hidden');
        }
      }
      
      function logout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('id_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/';
      }
      
      // Initialize auth UI on page load
      document.addEventListener('DOMContentLoaded', function() {
        initTheme();
        checkAuthAndUpdateUI();
      });
    </script>
</body>
</html>`;

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