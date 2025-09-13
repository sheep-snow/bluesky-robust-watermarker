import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { wrapWithLayout } from '../common/ui-framework';

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

    // Generate provenance page content
    const content = `
      <div class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
        <div class="hero-content text-center py-12">
          <div class="max-w-md">
            <h1 class="mb-5 text-4xl font-bold">🔍 Image Provenance</h1>
            <p class="mb-5 text-lg">来歴</p>
            <div class="flex gap-4 justify-center">
              <a href="/mypage" class="btn btn-soft btn-primary">← Back to My Page</a>
              <a href="/users/${userInfo.provenancePageId}.html" class="btn btn-accent">← Provenance List</a>
            </div>
          </div>
        </div>
      </div>
    
      <div class="card bg-base-100 shadow-xl mb-8">
        <div class="card-body">
          <h2 class="card-title text-2xl text-primary">📋 Bluesky 投稿の情報</h2>
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
          <h3 class="card-title text-xl text-primary">💬 投稿文</h3>
          <div class="card bg-base-200 p-4">
            <p class="text-base-content">${postData.text}</p>
          </div>
        </div>
      </div>
      ` : ''}
    
      ${event.hasWatermarkedImage || event.hasProcessedImage ? `
      <div class="card bg-base-100 shadow-xl mb-8">
        <div class="card-body">
          <h3 class="card-title text-xl text-primary">🖼️ 透かし埋込済画像</h3>
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

    const provenanceHtml = wrapWithLayout(`${APP_NAME} - Provenance for Post ${postId}`, content, 'provenance');

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