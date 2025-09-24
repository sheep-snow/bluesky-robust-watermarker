import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { wrapWithLayout } from '../common/ui-framework';
import { UserDB } from '../common/user-db';
import { PostDB } from '../common/post-db';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

const updateProgress = async (taskId: string, status: string, progress: number, message: string, error?: string) => {
  try {
    const tableName = process.env.PROCESSING_PROGRESS_TABLE_NAME;
    if (!tableName) return;
    
    const item: any = {
      task_id: { S: taskId },
      status: { S: status },
      progress: { N: progress.toString() },
      message: { S: message },
      updated_at: { S: Math.floor(Date.now() / 1000).toString() },
      ttl: { N: (Math.floor(Date.now() / 1000) + 86400).toString() }
    };
    
    if (error) item.error = { S: error };
    
    await dynamodb.send(new PutItemCommand({ TableName: tableName, Item: item }));
  } catch (e) {
    console.error('Failed to update progress:', e);
  }
};

const markFailed = async (taskId: string, errorMessage: string, progress: number = 80) => {
  await updateProgress(taskId, 'error', progress, 'Provenance generation failed', errorMessage);
};

const APP_NAME = process.env.APP_NAME || 'brw';
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const userDB = new UserDB(process.env.USERS_TABLE_NAME);
const postDB = new PostDB(process.env.POSTS_TABLE_NAME);

export const handler = async (event: any) => {
  console.log('Generate provenance handler started, event:', JSON.stringify(event));

  // Handle Map task output (array) or direct input (object)
  const eventData = Array.isArray(event) ? event[0] : event;
  const { postId, userId, bucket, blueskyPostUri, postedAt } = eventData;

  try {
    await updateProgress(postId, 'generating', 75, 'Generating provenance page');
    // Get post data
    const postCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: `${postId}/post.json`
    });
    const postResult = await s3Client.send(postCommand);
    const postData = JSON.parse(await postResult.Body!.transformToString());
    
    // Handle both old single image format and new multiple images format
    const hasImages = (postData.imageMetadata && postData.imageMetadata.length > 0) || postData.image;
    const imageCount = postData.imageMetadata ? postData.imageMetadata.length : (postData.image ? 1 : 0);

    // Get user info from DynamoDB
    const userInfo = await userDB.getUserInfo(userId);
    if (!userInfo) {
      throw new Error(`User info not found for userId: ${userId}`);
    }

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
                ${hasImages ? `
                <tr>
                  <th class="bg-base-200">Images</th>
                  <td>${imageCount} image${imageCount > 1 ? 's' : ''} attached</td>
                </tr>
                ` : ''}
                ${postData.contentLabels && postData.contentLabels.length > 0 ? `
                <tr>
                  <th class="bg-base-200">Content Labels</th>
                  <td>
                    <div class="flex flex-wrap gap-2">
                      ${postData.contentLabels.map((label: string) => {
                        const labelMap: { [key: string]: string } = {
                          'suggestive': 'きわどい',
                          'nudity': 'ヌード',
                          'porn': '成人向け',
                          'graphic-media': '生々しいメディア'
                        };
                        return `<span class="badge badge-warning">${labelMap[label] || label}</span>`;
                      }).join('')}
                    </div>
                  </td>
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
          ${postData.contentLabels && postData.contentLabels.length > 0 ? `
          <div class="mt-4">
            <h4 class="font-semibold mb-2">Content Labels:</h4>
            <div class="flex flex-wrap gap-2">
              ${postData.contentLabels.map((label: string) => {
                const labelMap: { [key: string]: string } = {
                  'suggestive': 'きわどい',
                  'nudity': 'ヌード', 
                  'porn': '成人向け',
                  'graphic-media': '生々しいメディア'
                };
                return `<span class="badge badge-warning">${labelMap[label] || label}</span>`;
              }).join('')}
            </div>
          </div>
          ` : ''}
        </div>
      </div>
      ` : ''}
      
      ${hasImages && postData.imageMetadata ? `
      <div class="card bg-base-100 shadow-xl mb-8">
        <div class="card-body">
          <h3 class="card-title text-xl text-primary">🖼️ 画像情報</h3>
          <div class="space-y-4">
            ${postData.imageMetadata.map((imageMeta: any, index: number) => `
            <div class="card bg-base-200 p-4">
              <div class="flex justify-between items-start">
                <div>
                  <h4 class="font-semibold">画像 ${imageMeta.index}</h4>
                  <p class="text-sm text-base-content/70">Format: ${imageMeta.format?.toUpperCase() || 'Unknown'}</p>
                </div>
              </div>
              ${imageMeta.altText ? `
              <div class="mt-3">
                <h5 class="font-medium text-sm">ALT Text:</h5>
                <p class="text-base-content bg-base-100 p-2 rounded mt-1">${imageMeta.altText}</p>
              </div>
              ` : ''}
            </div>
            `).join('')}
          </div>
        </div>
      </div>
      ` : ''}
    
      ${event.hasWatermarkedImage || event.hasProcessedImage ? `
      <div class="card bg-base-100 shadow-xl mb-8">
        <div class="card-body">
          <h3 class="card-title text-xl text-primary">🔒 Watermark Protection</h3>
          ${event.hasWatermarkedImage ? `
          <div class="alert alert-success">
            <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div>
              <h4 class="font-bold">Watermark Embedded</h4>
              <div class="text-sm mt-2">
                <p>This post's image contains a watermark embedding the Post ID: <span class="font-mono font-bold">${postId}</span></p>
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

    console.log('Generated provenance page with content labels:', postData.contentLabels || []);

    // Save post info to DynamoDB
    await updateProgress(postId, 'generating', 85, 'Saving post information');
    const postInfo = {
      postId,
      userId,
      blueskyUserId: userInfo.blueskyUserId,
      text: postData.text,
      imageMetadata: postData.imageMetadata,
      contentLabels: postData.contentLabels,
      blueskyPostUri,
      postedAt,
      createdAt: postData.createdAt,
      provenancePageId: userInfo.provenancePageId
    };
    await postDB.savePost(postInfo);

    // Save provenance page to public bucket
    await updateProgress(postId, 'generating', 90, 'Saving provenance page');
    const provenanceCommand = new PutObjectCommand({
      Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
      Key: `provenance/${postId}/index.html`,
      Body: provenanceHtml,
      ContentType: 'text/html'
    });
    await s3Client.send(provenanceCommand);

    // Note: Images are no longer copied to provenance bucket to avoid storing unnecessary data
    console.log('Skipping image copy to provenance bucket - images are not displayed on provenance pages');

    const provenanceUrl = `https://${process.env.PROVENANCE_PUBLIC_BUCKET}.s3.amazonaws.com/provenance/${postId}/index.html`;

    await updateProgress(postId, 'generating', 95, 'Provenance page completed');
    
    return {
      ...eventData,
      provenanceUrl,
      provenanceGenerated: true
    };

  } catch (error) {
    console.error('Provenance generation failed:', error);
    await markFailed(postId, error.message || 'Unknown error');
    throw error;
  }
};