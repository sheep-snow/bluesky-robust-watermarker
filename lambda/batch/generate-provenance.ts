import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const APP_NAME = process.env.APP_NAME || 'brw';
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event: any) => {
  console.log('Generate provenance event:', JSON.stringify(event, null, 2));

  const { postId, userId, bucket, blueskyPostUri, postedAt } = event;

  try {
    // Get post data
    const postCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: `${postId}/post.json`
    });
    const postResult = await s3Client.send(postCommand);
    const postData = JSON.parse(await postResult.Body!.transformToString());

    // Get user info
    const userCommand = new GetObjectCommand({
      Bucket: process.env.USER_INFO_BUCKET,
      Key: `${userId}.json`
    });
    const userResult = await s3Client.send(userCommand);
    const userInfo = JSON.parse(await userResult.Body!.transformToString());

    // Generate provenance page HTML
    const provenanceHtml = `
<!DOCTYPE html>
<html data-theme="cupcake">
<head>
    <title>${APP_NAME} - Provenance for Post ${postId}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css" rel="stylesheet" type="text/css" />
    <script src="https://cdn.tailwindcss.com"></script>
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
        <a href="/" class="btn btn-ghost text-xl">🔍 ${APP_NAME}</a>
      </div>
      <div class="navbar-center hidden lg:flex">
        <ul class="menu menu-horizontal px-1">
          <li><a href="/">Home</a></li>
          <li><a href="/signup" id="nav-signup">Sign Up</a></li>
          <li><a href="/login" id="nav-login">Login</a></li>
          <li><a href="/mypage" id="nav-mypage">My Page</a></li>
          <li><a href="/users/${userInfo.provenancePageId}.html">Provenance List</a></li>
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
            <h1 class="mb-5 text-4xl font-bold">🔍 Image Provenance</h1>
            <p class="mb-5 text-lg">Verified image provenance information</p>
            <div class="flex gap-4 justify-center">
              <a href="/mypage" class="btn btn-outline btn-primary">← Back to My Page</a>
              <a href="/users/${userInfo.provenancePageId}.html" class="btn btn-accent">← Provenance List</a>
            </div>
          </div>
        </div>
      </div>
    
      <div class="card bg-base-100 shadow-xl mb-8">
        <div class="card-body">
          <h2 class="card-title text-2xl text-primary">📋 Post Information</h2>
          <div class="overflow-x-auto">
            <table class="table table-zebra">
              <tbody>
                <tr>
                  <th class="bg-base-200">Post ID</th>
                  <td class="font-mono">${postId}</td>
                </tr>
                <tr>
                  <th class="bg-base-200">Author</th>
                  <td class="font-bold">${userInfo.blueskyUserId}</td>
                </tr>
                <tr>
                  <th class="bg-base-200">Created</th>
                  <td>${new Date(postData.createdAt).toLocaleString()}</td>
                </tr>
                <tr>
                  <th class="bg-base-200">Posted to Bluesky</th>
                  <td>${new Date(postedAt).toLocaleString()}</td>
                </tr>
                ${blueskyPostUri ? `
                <tr>
                  <th class="bg-base-200">Bluesky Post</th>
                  <td><a href="https://bsky.app/profile/${userInfo.blueskyUserId}/post/${blueskyPostUri.split('/').pop()}" target="_blank" class="link link-primary">View on Bluesky</a></td>
                </tr>
                ` : ''}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    
      ${postData.text ? `
      <div class="card bg-base-100 shadow-xl mb-8">
        <div class="card-body">
          <h3 class="card-title text-xl text-primary">💬 Post Text</h3>
          <div class="card bg-base-200 p-4">
            <p class="text-base-content">${postData.text}</p>
          </div>
        </div>
      </div>
      ` : ''}
    
      ${event.hasWatermarkedImage || event.hasProcessedImage ? `
      <div class="card bg-base-100 shadow-xl mb-8">
        <div class="card-body">
          <h3 class="card-title text-xl text-primary">🖼️ Verified Image</h3>
          <div class="text-center">
            <img src="/provenance/${postId}/image.${postData.imageExtension || 'jpg'}" alt="Post image" class="max-w-full h-auto rounded-lg shadow-md" />
          </div>
          ${event.hasWatermarkedImage ? `
          <div class="alert alert-success mt-6">
            <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div>
              <h4 class="font-bold">🔒 Watermark Protection</h4>
              <div class="text-sm mt-2">
                <p>This image contains a watermark embedding the Post ID: <span class="font-mono font-bold">${postId}</span></p>
                <p>The watermark is resistant to compression, resizing, and other image manipulations.</p>
                ${event.watermarkData ? `
                <div class="collapse collapse-arrow bg-base-200 mt-4">
                  <input type="checkbox" />
                  <div class="collapse-title text-xl font-medium">
                    Technical Details
                  </div>
                  <div class="collapse-content">
                    <ul class="list-disc list-inside space-y-1">
                      <li><strong>Watermark Method:</strong> ${event.watermarkData.method || 'Trustmark'}</li>
                      <li><strong>Sequence Length:</strong> ${event.watermarkData.length || 'N/A'}</li>
                      <li><strong>Embedded At:</strong> ${event.watermarkData.generatedAt ? new Date(event.watermarkData.generatedAt).toLocaleString() : 'N/A'}</li>
                      <li><strong>Post ID Encoded:</strong> ${event.watermarkData.postId}</li>
                    </ul>
                  </div>
                </div>
                ` : ''}
              </div>
            </div>
          </div>
          ` : ''}
        </div>
      </div>
      ` : ''}
    
      <div class="card bg-base-100 shadow-xl mb-8">
        <div class="card-body">
          <h3 class="card-title text-xl text-primary">🛡️ Verification Metadata</h3>
          <div class="stats stats-vertical lg:stats-horizontal shadow">
            <div class="stat">
              <div class="stat-figure text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              </div>
              <div class="stat-title">Watermark</div>
              <div class="stat-value text-primary">${event.WatermarkEmbedded || event.trustMarkEmbedded ? 'Embedded' : 'Not Embedded'}</div>
            </div>
            <div class="stat">
              <div class="stat-figure text-secondary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"></path></svg>
              </div>
              <div class="stat-title">Processing Date</div>
              <div class="stat-value text-secondary text-lg">${new Date().toLocaleDateString()}</div>
              <div class="stat-desc">${new Date().toLocaleTimeString()}</div>
            </div>
            <div class="stat">
              <div class="stat-figure text-accent">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
              </div>
              <div class="stat-title">Status</div>
              <div class="stat-value text-accent">Verified</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="text-center py-8 bg-base-300">
      <p class="text-base-content">This page was generated by ${APP_NAME} to provide verifiable provenance information for this image.</p>
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

    // Save provenance page to public bucket
    const provenanceCommand = new PutObjectCommand({
      Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
      Key: `provenance/${postId}/index.html`,
      Body: provenanceHtml,
      ContentType: 'text/html'
    });
    await s3Client.send(provenanceCommand);

    // Copy image to public provenance bucket if exists
    try {
      // Get image extension from post data or default to jpg
      const imageExtension = postData.imageExtension || 'jpg';
      const imageFormat = postData.imageFormat || 'jpeg';

      // Use the actual S3 key structure: postId/image.extension
      const imageKey = `${postId}/image.${imageExtension}`;

      console.log('Attempting to get image from S3:', { bucket, imageKey });

      const imageCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: imageKey
      });
      const imageResult = await s3Client.send(imageCommand);
      const imageBuffer = await imageResult.Body!.transformToByteArray();

      console.log('Successfully retrieved image from S3, size:', imageBuffer.length);

      const copyImageCommand = new PutObjectCommand({
        Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
        Key: `provenance/${postId}/image.${imageExtension}`,
        Body: imageBuffer,
        ContentType: imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png'
      });
      await s3Client.send(copyImageCommand);
      console.log('Image copied to provenance bucket successfully');
    } catch (imageError) {
      console.log('Failed to copy image to provenance bucket:', imageError);
      // Continue without image - the provenance page will still be generated
    }

    const provenanceUrl = `https://${process.env.PROVENANCE_PUBLIC_BUCKET}.s3.amazonaws.com/provenance/${postId}/index.html`;

    return {
      ...event,
      provenanceUrl,
      provenanceGenerated: true
    };

  } catch (error) {
    console.error('Provenance generation failed:', error);
    throw error;
  }
};