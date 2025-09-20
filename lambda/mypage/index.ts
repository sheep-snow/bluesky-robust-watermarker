const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { KMSClient, EncryptCommand, DecryptCommand } = require('@aws-sdk/client-kms');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { AtpAgent } = require('@atproto/api');
const { sanitizeUserInput } = require('../common/sanitize');
const { detectImageFormat, getImageExtension, getContentType } = require('../common/image-utils');
const { wrapWithLayout } = require('../common/ui-framework');

// アプリ名を環境変数から取得
const APP_NAME = process.env.APP_NAME || 'brw';

function decodeJWT(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
}

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const kmsClient = new KMSClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

const { nanoid } = require('nanoid');

// nanoid generator for unique post identification (8 characters for BCH_5 compatibility)
class PostIdGenerator {
  static generate() {
    return nanoid(8);
  }
}

// UUID generator
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Generate empty provenance list page for new users
async function generateEmptyProvenanceList(userInfo: any) {
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

    <div class="stats stats-vertical lg:stats-horizontal shadow mb-8 bg-base-100">
      <div class="stat">
        <div class="stat-figure text-primary">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
        </div>
        <div class="stat-title">来歴数</div>
        <div class="stat-value text-primary">0</div>
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
  `;

  const listPageHtml = wrapWithLayout(`${APP_NAME} - ${userInfo.blueskyUserId} Provenance List`, content, 'provenance-list');

  // Save empty user list page to public bucket
  const listPageCommand = new PutObjectCommand({
    Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
    Key: `users/${userInfo.provenancePageId}.html`,
    Body: listPageHtml,
    ContentType: 'text/html'
  });
  await s3Client.send(listPageCommand);

  console.log(`Empty provenance list created for user: ${userInfo.blueskyUserId}`);
}

// Check if provenance list exists for a user
async function checkProvenanceListExists(provenancePageId: string): Promise<boolean> {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
      Key: `users/${provenancePageId}.html`
    });
    await s3Client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return false;
    }
    throw error;
  }
}

async function encryptPassword(password: string, keyId: string) {
  const encryptCommand = new EncryptCommand({
    KeyId: keyId,
    Plaintext: Buffer.from(password, 'utf8')
  });
  const result = await kmsClient.send(encryptCommand);
  return Buffer.from(result.CiphertextBlob).toString('base64');
}

async function decryptPassword(encryptedPassword: string, keyId: string) {
  const decryptCommand = new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedPassword, 'base64')
  });
  const result = await kmsClient.send(decryptCommand);
  return Buffer.from(result.Plaintext).toString('utf8');
}

async function getUserInfo(userId: string) {
  try {
    const getCommand = new GetObjectCommand({
      Bucket: process.env.USER_INFO_BUCKET,
      Key: `${userId}.json`
    });
    const result = await s3Client.send(getCommand);
    const rawUserInfo = JSON.parse(await result.Body.transformToString());
    const userInfo = sanitizeUserInput(rawUserInfo);
    // App Passwordは返さない
    return {
      blueskyUserId: userInfo.blueskyUserId,
      updatedAt: userInfo.updatedAt,
      validatedAt: userInfo.validatedAt,
      provenancePageId: userInfo.provenancePageId,
      createdAt: userInfo.createdAt // 追加
    };
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}


async function validateBlueskyCredentials(userId: string, appPassword: string) {
  console.log('Starting Bluesky validation for:', userId);

  try {
    const agent = new AtpAgent({ service: 'https://bsky.social' });
    console.log('AtpAgent created successfully');

    console.log('Login parameters:');
    console.log('  - identifier:', JSON.stringify(userId));
    console.log('  - password: [REDACTED]');
    console.log('  - password length:', appPassword.length);

    try {
      const loginResult = await agent.login({
        identifier: userId,
        password: appPassword
      });

      console.log('✅ Login successful!');
      console.log('Login result type:', typeof loginResult);
      console.log('Login result success:', loginResult?.success);

      if (agent.session) {
        console.log('✅ Session created successfully');
        console.log('Session DID:', agent.session.did);
        console.log('Session handle:', agent.session.handle);
        return true;
      } else {
        console.log('⚠️ Login succeeded but no session created');
        return false;
      }
    } catch (loginError: any) {
      console.log('❌ Login failed with error:');
      console.log('Error type:', typeof loginError);
      console.log('Error name:', loginError.name);
      console.log('Error message:', loginError.message);
      console.log('Error status:', loginError.status);
      console.log('Error cause:', loginError.cause);
      console.log('Error stack:', loginError.stack);

      if (loginError.headers) {
        console.log('Error headers:', loginError.headers);
      }

      return false;
    }

  } catch (error: any) {
    console.error('❌ Fatal error in validateBlueskyCredentials:');
    console.error('Error message:', error.message);
    return false;
  }
}

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Log event without body to avoid large image data in logs
    const logEvent = { ...event, body: event.body ? '[BODY_PRESENT]' : null };
    console.log('Event:', JSON.stringify(logEvent, null, 2));

    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod === 'GET') {
      // Handle /mypage/info endpoint for user info retrieval
      if (event.path === '/mypage/info' || (event.pathParameters && event.pathParameters.proxy === 'info')) {
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader) {
          return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
        }

        try {
          const token = authHeader.replace('Bearer ', '');
          const decoded = decodeJWT(token);
          console.log('Decoded token userId:', decoded?.sub);
          const userId = decoded?.sub;

          if (!userId) {
            console.log('No userId found in token');
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
          }

          const userInfo = await getUserInfo(userId);

          // If user info exists but provenance list doesn't exist, create it
          if (userInfo && userInfo.provenancePageId) {
            try {
              const provenanceListExists = await checkProvenanceListExists(userInfo.provenancePageId);
              if (!provenanceListExists) {
                console.log(`Provenance list not found for user ${userInfo.blueskyUserId}, creating empty list`);
                await generateEmptyProvenanceList(userInfo);
              }
            } catch (error) {
              console.error('Failed to check/create provenance list:', error);
              // Don't fail the entire request if provenance list check fails
            }
          }

          return { statusCode: 200, headers, body: JSON.stringify(userInfo || {}) };
        } catch (error) {
          console.error('Get user info error:', error);
          return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to get user info' }) };
        }
      }

      const content = `
        <div class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
          <div class="hero-content text-center py-12">
            <div class="max-w-md">
              <h1 class="mb-5 text-4xl font-bold">📄 My Page</h1>
              <p class="mb-5 text-lg">Blueskyのアプリパスワードを登録し、作品を投稿する</p>
            </div>
          </div>
        </div>
        
        <div id="authStatus" class="alert alert-info">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <span>Checking authentication...</span>
        </div>
        
        <div id="content" class="hidden">
          <div class="flex justify-end mb-6 gap-4">
            <a href="#" id="provenanceListLink" class="btn btn-soft" disabled>来歴の一覧</a>
          </div>
          
          <div class="grid grid-cols-1 gap-8">
            <div class="card bg-base-100 shadow-xl">
              <div class="card-body">
                <details class="collapse bg-base-100 border-base-300 border" id="blueskySettings">
                  <summary class="collapse-title font-semibold text-2xl">🔗 Bluesky 設定</summary>
                  <div class="collapse-content">
                    <form id="settingsForm" class="space-y-4">
                      <div class="form-control">
                        <label class="label">
                          <span class="label-text font-semibold">Bluesky User ID</span>
                        </label>
                        <input type="text" id="blueskyUserId" placeholder="alice.bsky.social or @alice.bsky.social" class="input input-bordered" />
                      </div>
                      <div class="form-control">
                        <label class="label">
                          <span class="label-text font-semibold">Bluesky App Password</span>
                        </label>
                        <input type="password" id="blueskyAppPassword" placeholder="abcd-efgh-ijkl-mnop" class="input input-bordered" />
                      </div>
                      <button type="submit" class="btn btn-primary w-full">保存</button>
                    </form>
                  </div>
                </details>
              </div>
            </div>
            
            <div class="card bg-base-100 shadow-xl">
              <div class="card-body">
                <h2 class="card-title text-2xl mb-4">✍️ 作品を投稿</h2>
                <form id="postForm" class="space-y-4">
                  <div class="form-control">
                    <label class="label">
                      <span class="label-text font-semibold">投稿文</span>
                      <span class="label-text-alt">最大300文字</span>
                    </label>
                    <textarea id="postText" rows="4" placeholder="投稿文..." class="textarea textarea-bordered" maxlength="300"></textarea>
                  </div>
                  <div class="form-control">
                    <label class="label">
                      <span class="label-text font-semibold">画像 (最大4枚)</span>
                      <div class="flex gap-2">
                        <button type="button" id="addImageBtn" class="btn btn-sm btn-outline">+ 追加</button>
                        <button type="button" id="removeImageBtn" class="btn btn-sm btn-outline">- 削除</button>
                      </div>
                    </label>
                    <div id="imageInputs" class="space-y-4">
                      <div class="grid grid-cols-2 gap-4 image-row" data-index="1">
                        <input type="file" id="postImage1" accept="image/*" class="file-input file-input-bordered" />
                        <textarea id="altText1" rows="2" placeholder="画像1の説明..." class="textarea textarea-bordered" maxlength="2000"></textarea>
                      </div>
                    </div>
                  </div>
                  <details class="collapse bg-base-100 border-base-300 border">
                    <summary class="collapse-title font-semibold">投稿への反応の設定</summary>
                    <div class="collapse-content">
                      <div class="space-y-4">

                        <div>
                          <h4 class="font-medium text-sm mb-2">返信の設定</h4>
                          <label class="cursor-pointer flex items-center gap-3">
                            <input type="checkbox" id="replySettings" class="toggle toggle-primary" checked />
                            <span class="label-text" id="replyLabel">全員</span>
                          </label>
                          <div id="replyOptions" class="mt-3 pl-6">
                            <h5 class="font-medium text-xs mb-2 text-base-content/70">オプション</h5>
                            <div class="space-y-2">
                              <label class="cursor-pointer label justify-start gap-3">
                                <input type="checkbox" id="replyMentioned" class="checkbox checkbox-sm reply-option" />
                                <span class="label-text text-sm">メンションされたユーザー</span>
                              </label>
                              <label class="cursor-pointer label justify-start gap-3">
                                <input type="checkbox" id="replyFollowing" class="checkbox checkbox-sm reply-option" />
                                <span class="label-text text-sm">フォローしているユーザー</span>
                              </label>
                              <label class="cursor-pointer label justify-start gap-3">
                                <input type="checkbox" id="replyFollowers" class="checkbox checkbox-sm reply-option" />
                                <span class="label-text text-sm">フォロワー</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </details>
                  <details class="collapse bg-base-100 border-base-300 border">
                    <summary class="collapse-title font-semibold">ラベル</summary>
                    <div class="collapse-content">
                      <div class="space-y-4">
                        <div>
                          <h4 class="font-medium text-sm mb-2">成人向けコンテンツ</h4>
                          <div class="space-y-2">
                            <label class="cursor-pointer label justify-start gap-3">
                              <input type="checkbox" id="labelSuggestive" value="suggestive" class="checkbox checkbox-sm adult-content-checkbox" />
                              <span class="label-text">きわどい</span>
                            </label>
                            <label class="cursor-pointer label justify-start gap-3">
                              <input type="checkbox" id="labelNudity" value="nudity" class="checkbox checkbox-sm adult-content-checkbox" />
                              <span class="label-text">ヌード</span>
                            </label>
                            <label class="cursor-pointer label justify-start gap-3">
                              <input type="checkbox" id="labelPorn" value="porn" class="checkbox checkbox-sm adult-content-checkbox" />
                              <span class="label-text">成人向け</span>
                            </label>
                          </div>
                        </div>
                        <div>
                          <h4 class="font-medium text-sm mb-2">その他</h4>
                          <label class="cursor-pointer label justify-start gap-3">
                            <input type="checkbox" id="labelGraphicMedia" class="checkbox checkbox-sm" />
                            <span class="label-text">生々しいメディア</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </details>
                  <button type="submit" id="postSubmitBtn" class="btn btn-accent w-full" disabled>投稿</button>
                </form>
              </div>
            </div>
          </div>
          
          <div id="userInfo" class="card bg-base-100 shadow-xl mt-8 hidden">
            <div class="card-body">
              <h3 class="card-title text-xl mb-4">📊 Current Settings</h3>
              <div class="stats stats-vertical lg:stats-horizontal shadow">
                <div class="stat">
                  <div class="stat-title">Bluesky User ID</div>
                  <div class="stat-value text-lg" id="currentUserId"></div>
                </div>
                <div class="stat">
                  <div class="stat-title">Last Updated</div>
                  <div class="stat-value text-lg" id="lastUpdated"></div>
                </div>
                <div class="stat">
                  <div class="stat-title">Last Validated</div>
                  <div class="stat-value text-lg" id="lastValidated"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Processing Modal -->
        <dialog id="processingModal" class="modal">
          <div class="modal-box">
            <h3 class="font-bold text-lg">🔄 Processing Your Post</h3>
            <div class="py-4">
              <div class="flex items-center space-x-4">
                <span class="loading loading-spinner loading-lg text-primary"></span>
                <div>
                  <p class="text-base-content">Post ID: <span id="processingPostId" class="font-mono font-bold"></span></p>
                  <p class="text-sm text-base-content/70 mt-2" id="processingStatus">Generating provenance page...</p>
                  <p class="text-xs text-base-content/50 mt-1" id="processingCountdown">最大待機時間: 180秒</p>
                </div>
              </div>
              <div class="mt-6">
                <progress class="progress progress-primary w-full" id="processingProgress"></progress>
                <div class="text-xs text-base-content/70 mt-4">
                  <div id="processingSteps" class="space-y-2">
                    <div class="step flex items-center space-x-2" id="step-watermark">
                      <span>📝</span><span>Embedding watermark...</span>
                    </div>
                    <div class="step flex items-center space-x-2" id="step-bluesky">
                      <span>🦋</span><span>Posting to Bluesky...</span>
                    </div>
                    <div class="step flex items-center space-x-2" id="step-provenance">
                      <span>📄</span><span>Generating provenance page...</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-action">
              <button class="btn btn-sm" onclick="document.getElementById('processingModal').close()">閉じる</button>
            </div>
          </div>
        </dialog>
        
        <script>
          // Progress polling function with timeout
          const startProgressPolling = async (taskId) => {
            const startTime = Date.now();
            const timeoutMs = 180000; // 180 seconds
            let timeoutReached = false;
            
            const updateCountdown = () => {
              const elapsed = Date.now() - startTime;
              const remaining = Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));
              const countdownEl = document.getElementById('processingCountdown');
              if (countdownEl) {
                countdownEl.textContent = '最大待機時間: ' + remaining + '秒';
                if (remaining <= 30) {
                  countdownEl.style.color = '#ef4444';
                }
              }
              return remaining > 0;
            };
            
            const pollProgress = async () => {
              if (!updateCountdown()) {
                timeoutReached = true;
                document.getElementById('processingModal').close();
                alert('処理がタイムアウトしました。時間をおいて再度お試しください。');
                return;
              }
              
              try {
                const response = await fetch('/progress/' + taskId, {
                  headers: { 'Authorization': 'Bearer ' + accessToken }
                });
                
                if (response.ok) {
                  const progress = await response.json();
                  updateProgressModal(progress);
                  
                  if (!progress.completed && !timeoutReached) {
                    const interval = progress.status === 'error' ? 1000 : 2000;
                    setTimeout(pollProgress, interval);
                  } else if (progress.completed) {
                    setTimeout(() => {
                      document.getElementById('processingModal').close();
                      if (progress.status === 'completed') {
                        alert('投稿が完了しました！');
                        location.reload();
                      } else {
                        alert('エラーが発生しました: ' + (progress.error || 'Unknown error'));
                      }
                    }, progress.status === 'error' ? 500 : 1000);
                  }
                }
              } catch (error) {
                console.error('Progress polling error:', error);
                if (!timeoutReached) {
                  setTimeout(() => {
                    document.getElementById('processingModal').close();
                    alert('進捗の取得に失敗しました。ページを更新してください。');
                  }, 2000);
                }
              }
            };
            
            pollProgress();
          };
          
          // Update progress modal
          const updateProgressModal = (progress) => {
            document.getElementById('processingProgress').value = progress.progress || 0;
            document.getElementById('processingStatus').textContent = progress.message || 'Processing...';
            
            // Update step indicators
            const steps = ['watermark', 'bluesky', 'provenance'];
            steps.forEach((step, index) => {
              const element = document.getElementById('step-' + step);
              const threshold = (index + 1) * 33;
              if (progress.progress >= threshold) {
                element.style.opacity = '1';
                element.style.color = '#10b981';
              } else if (progress.status === 'error') {
                element.style.opacity = '1';
                element.style.color = '#ef4444';
              } else {
                element.style.opacity = '0.5';
              }
            });
            
            // Show error state
            if (progress.status === 'error') {
              document.getElementById('processingStatus').style.color = '#ef4444';
              document.querySelector('.loading-spinner').style.display = 'none';
            }
          };
          
          // Check authentication
          const accessToken = localStorage.getItem('access_token');
          const idToken = localStorage.getItem('id_token');
          
          if (!accessToken || !idToken) {
            document.getElementById('authStatus').innerHTML = 
              '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg><span>まだログインしていません。 <a href="/signup" class="link">サインアップしてください。</a> or <a href="/login" class="link">login</a>.</span>';
            document.getElementById('authStatus').className = 'alert alert-warning';
          } else {
            document.getElementById('authStatus').classList.add('hidden');
            document.getElementById('content').classList.remove('hidden');
            
            // Load existing user info
            loadUserInfo();
            
            // Initialize image input management
            initializeImageInputs();
            
            // Initialize submit button validation
            validateSubmitButton();
            
            // Handle adult content checkbox exclusivity
            document.querySelectorAll('.adult-content-checkbox').forEach(checkbox => {
              checkbox.addEventListener('change', function() {
                if (this.checked) {
                  document.querySelectorAll('.adult-content-checkbox').forEach(other => {
                    if (other !== this) other.checked = false;
                  });
                }
              });
            });
            

            
            // Handle reply settings toggle and visibility
            document.getElementById('replySettings').addEventListener('change', function() {
              const label = document.getElementById('replyLabel');
              const replyOptions = document.getElementById('replyOptions');
              
              if (this.checked) {
                label.textContent = '全員';
                replyOptions.style.display = 'block';
              } else {
                label.textContent = '返信不可';
                replyOptions.style.display = 'none';
              }
            });
            
            // Settings form submission
            document.getElementById('settingsForm').addEventListener('submit', async (e) => {
              e.preventDefault();
              
              const data = {
                blueskyUserId: document.getElementById('blueskyUserId').value,
                blueskyAppPassword: document.getElementById('blueskyAppPassword').value
              };
              
              try {
                const response = await fetch('/mypage', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + accessToken
                  },
                  body: JSON.stringify(data)
                });
                
                if (response.ok) {
                  alert('Settings saved and validated successfully!');
                  loadUserInfo();
                } else {
                  const errorData = await response.json();
                  alert('設定の保存に失敗しました: ' + (errorData.error || 'Unknown error'));
                }
              } catch (error) {
                alert('Network error: ' + error.message);
              }
            });
            
            // Post form submission
            let isSubmitting = false;
            document.getElementById('postForm').addEventListener('submit', async (e) => {
              e.preventDefault();
              
              // Prevent double submission
              if (isSubmitting) {
                return;
              }
              isSubmitting = true;
              
              // Disable submit button
              const submitBtn = document.getElementById('postSubmitBtn');
              submitBtn.disabled = true;
              submitBtn.textContent = '処理中...';
              
              const text = document.getElementById('postText').value;
              
              // Get content labels
              const contentLabels = [];
              const adultContentCheckboxes = document.querySelectorAll('.adult-content-checkbox:checked');
              if (adultContentCheckboxes.length > 0) contentLabels.push(adultContentCheckboxes[0].value);
              if (document.getElementById('labelGraphicMedia').checked) contentLabels.push('graphic-media');
              
              // Get interaction settings
              const replySettings = document.getElementById('replySettings').checked ? 'everyone' : 'none';
              const replyOptions = [];
              if (replySettings === 'everyone') {
                if (document.getElementById('replyMentioned').checked) replyOptions.push('mentioned');
                if (document.getElementById('replyFollowing').checked) replyOptions.push('following');
                if (document.getElementById('replyFollowers').checked) replyOptions.push('followers');
              }
              
              // Process multiple images
              const images = [];
              const imageRows = document.querySelectorAll('.image-row');
              
              // Generate task ID for progress tracking
              const taskId = 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
              
              // Show processing modal
              document.getElementById('processingPostId').textContent = taskId;
              document.getElementById('processingModal').showModal();
              
              // Start progress polling
              startProgressPolling(taskId);
              
              for (let i = 0; i < imageRows.length; i++) {
                const row = imageRows[i];
                const index = row.dataset.index;
                const imageFile = document.getElementById('postImage' + index).files[0];
                const altText = document.getElementById('altText' + index).value;
                
                if (imageFile) {
                  // Check file size limit (3MB)
                  if (imageFile.size > 3 * 1024 * 1024) {
                    alert('画像' + index + 'のファイルサイズは3MB以下にしてください。');
                    return;
                  }
                  
                  // Convert image to base64
                  const reader = new FileReader();
                  const imageBase64 = await new Promise((resolve) => {
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(imageFile);
                  });
                  
                  images.push({
                    image: imageBase64,
                    altText: altText
                  });
                }
              }
              
              const postData = {
                text: text,
                images: images,
                contentLabels: contentLabels,
                interactionSettings: {
                  reply: replySettings,
                  replyOptions: replyOptions
                }
              };
              
              const response = await fetch('/mypage/post', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + accessToken
                },
                body: JSON.stringify(postData)
              });
              
              if (response.ok) {
                const result = await response.json();
                
                // Show processing modal
                showProcessingModal(result.postId);
                
                // Reset form
                document.getElementById('postForm').reset();
                
                // Start checking for provenance page generation
                checkProvenanceGeneration(result.postId);
              } else {
                const errorData = await response.json();
                alert('投稿に失敗しました: ' + (errorData.error || 'Unknown error'));
                
                // Re-enable submit button on error
                isSubmitting = false;
                submitBtn.disabled = false;
                submitBtn.textContent = '投稿';
              }
            });
          }
          
          async function loadUserInfo() {
            try {
              const response = await fetch('/mypage/info', {
                method: 'GET',
                headers: {
                  'Authorization': 'Bearer ' + accessToken
                }
              });
              
              if (response.ok) {
                const userInfo = await response.json();
                if (userInfo.blueskyUserId) {
                  document.getElementById('blueskyUserId').value = userInfo.blueskyUserId;
                  document.getElementById('currentUserId').textContent = userInfo.blueskyUserId;
                  document.getElementById('lastUpdated').textContent = new Date(userInfo.updatedAt).toLocaleString();
                  document.getElementById('lastValidated').textContent = new Date(userInfo.validatedAt).toLocaleString();
                  document.getElementById('userInfo').classList.remove('hidden');
                  
                  // Enable provenance list link if user has provenance page ID
                  if (userInfo.provenancePageId) {
                    const provenanceLink = document.getElementById('provenanceListLink');
                    provenanceLink.href = '/users/' + userInfo.provenancePageId + '.html';
                    provenanceLink.removeAttribute('disabled');
                  }
                } else {
                  // No user info found, expand Bluesky settings
                  document.getElementById('blueskySettings').open = true;
                }
              } else {
                // Failed to get user info, expand Bluesky settings
                document.getElementById('blueskySettings').open = true;
              }
            } catch (error) {
              console.log('No existing user info found');
              // No user info found, expand Bluesky settings
              document.getElementById('blueskySettings').open = true;
            }
          }
          
          function showProcessingModal(postId) {
            document.getElementById('processingPostId').textContent = postId;
            document.getElementById('processingModal').showModal();
            updateProcessingProgress(0, 'Initializing processing...');
          }
          
          function updateProcessingProgress(percentage, status) {
            document.getElementById('processingProgress').value = percentage;
            document.getElementById('processingStatus').textContent = status;
          }
          
          function updateProcessingStep(stepId, completed = false) {
            const step = document.getElementById(stepId);
            if (completed) {
              step.style.color = '#10b981';
              const icon = step.querySelector('span:first-child');
              icon.textContent = '✅';
            }
          }
          
          async function checkProvenanceGeneration(postId) {
            const maxAttempts = 60; // 5 minutes maximum (5 second intervals)
            let attempts = 0;
            
            const checkInterval = setInterval(async () => {
              attempts++;
              
              try {
                // Update progress based on attempts
                const progress = Math.min((attempts / maxAttempts) * 100, 90);
                
                if (attempts <= 20) {
                  updateProcessingProgress(progress, 'Embedding watermark and posting to Bluesky...');
                  if (attempts === 10) updateProcessingStep('step-watermark', true);
                  if (attempts === 20) updateProcessingStep('step-bluesky', true);
                } else {
                  updateProcessingProgress(progress, 'Generating provenance page...');
                }
                
                // Check if provenance page exists
                const response = await fetch('/provenance/' + postId + '/', {
                  method: 'HEAD'
                });
                
                if (response.ok) {
                  // Provenance page is ready
                  clearInterval(checkInterval);
                  updateProcessingStep('step-provenance', true);
                  updateProcessingProgress(100, 'Provenance page generated successfully!');
                  
                  setTimeout(() => {
                    document.getElementById('processingModal').close();
                    window.location.href = '/provenance/' + postId + '/';
                  }, 1000);
                }
                
                if (attempts >= maxAttempts) {
                  // Timeout
                  clearInterval(checkInterval);
                  updateProcessingProgress(100, 'Timeout - please check manually');
                  
                  setTimeout(() => {
                    document.getElementById('processingModal').close();
                    alert('Processing is taking longer than expected. You can check the provenance page manually.');
                    window.location.href = '/provenance/' + postId + '/';
                  }, 2000);
                }
                
              } catch (error) {
                console.log('Checking provenance page...', error);
              }
            }, 5000); // Check every 5 seconds
          }
          
          function initializeImageInputs() {
            const addBtn = document.getElementById('addImageBtn');
            const removeBtn = document.getElementById('removeImageBtn');
            
            addBtn.addEventListener('click', () => {
              const container = document.getElementById('imageInputs');
              const currentRows = container.querySelectorAll('.image-row').length;
              
              if (currentRows < 4) {
                const newIndex = currentRows + 1;
                const newRow = document.createElement('div');
                newRow.className = 'grid grid-cols-2 gap-4 image-row';
                newRow.dataset.index = newIndex;
                newRow.innerHTML = 
                  '<input type="file" id="postImage' + newIndex + '" accept="image/*" class="file-input file-input-bordered" />' +
                  '<textarea id="altText' + newIndex + '" rows="2" placeholder="画像' + newIndex + 'の説明..." class="textarea textarea-bordered" maxlength="2000"></textarea>';
                
                // Add event listener to new file input
                newRow.querySelector('input[type="file"]').addEventListener('change', validateSubmitButton);
                container.appendChild(newRow);
              }
              
              updateImageButtons();
            });
            
            removeBtn.addEventListener('click', () => {
              const container = document.getElementById('imageInputs');
              const rows = container.querySelectorAll('.image-row');
              
              if (rows.length > 1) {
                rows[rows.length - 1].remove();
              }
              
              updateImageButtons();
              validateSubmitButton();
            });
            
            // Add event listener to initial file input
            document.getElementById('postImage1').addEventListener('change', validateSubmitButton);
            
            updateImageButtons();
          }
          
          function validateSubmitButton() {
            const imageRows = document.querySelectorAll('.image-row');
            const submitBtn = document.getElementById('postSubmitBtn');
            let hasImage = false;
            
            for (const row of imageRows) {
              const index = row.dataset.index;
              const fileInput = document.getElementById('postImage' + index);
              if (fileInput && fileInput.files && fileInput.files.length > 0) {
                hasImage = true;
                break;
              }
            }
            
            // Don't enable if currently submitting
            if (typeof isSubmitting === 'undefined' || !isSubmitting) {
              submitBtn.disabled = !hasImage;
            }
          }
          
          function updateImageButtons() {
            const container = document.getElementById('imageInputs');
            const currentRows = container.querySelectorAll('.image-row').length;
            const addBtn = document.getElementById('addImageBtn');
            const removeBtn = document.getElementById('removeImageBtn');
            
            addBtn.disabled = currentRows >= 4;
            removeBtn.disabled = currentRows <= 1;
          }
          
          function logout() {
            localStorage.removeItem('access_token');
            localStorage.removeItem('id_token');
            localStorage.removeItem('refresh_token');
            window.location.reload();
          }
        </script>
      `;

      const html = wrapWithLayout(`${APP_NAME} - My Page`, content, 'mypage');
      return { statusCode: 200, headers: { ...headers, 'Content-Type': 'text/html' }, body: html };
    }

    if (event.httpMethod === 'POST') {
      console.log('POST request received');
      const authHeader = event.headers.Authorization || event.headers.authorization;
      if (!authHeader) {
        console.log('No authorization header found');
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      const token = authHeader.replace('Bearer ', '');
      const decoded = decodeJWT(token);
      const userId = decoded?.sub;

      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
      }

      // Handle post creation
      if (event.path === '/mypage/post' || (event.pathParameters && event.pathParameters.proxy === 'post')) {
        try {
          // Parse JSON data with base64 encoded image
          const contentType = event.headers['content-type'] || event.headers['Content-Type'];
          if (!contentType || !contentType.includes('application/json')) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid content type, expected application/json' }) };
          }

          if (!event.body) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Request body is required' }) };
          }

          const rawBody = JSON.parse(event.body);
          const body = sanitizeUserInput(rawBody);
          // Log body without image data
          const logBody = { ...body };
          if (logBody.images) {
            logBody.images = logBody.images.map((img, i) => ({
              altText: img.altText,
              image: `[IMAGE_DATA_${img.image.length}_BYTES]`
            }));
          }
          console.log('Post creation body:', JSON.stringify(logBody, null, 2));
          const postId = PostIdGenerator.generate();

          let postData = {
            postId,
            userId,
            text: body.text || '',
            images: body.images || [],
            contentLabels: body.contentLabels || [],
            createdAt: new Date().toISOString()
          };

          // Save images if provided with format detection
          const imageMetadata = [];
          if (body.images && body.images.length > 0) {
            for (let i = 0; i < body.images.length; i++) {
              const imageData = body.images[i];
              const imageBuffer = Buffer.from(imageData.image, 'base64');
              const imageFormat = detectImageFormat(new Uint8Array(imageBuffer));
              const imageExtension = getImageExtension(imageFormat);
              const contentType = getContentType(imageFormat);

              const imageCommand = new PutObjectCommand({
                Bucket: process.env.POST_DATA_BUCKET,
                Key: `${postId}/image${i + 1}.${imageExtension}`,
                Body: imageBuffer,
                ContentType: contentType
              });
              await s3Client.send(imageCommand);

              imageMetadata.push({
                index: i + 1,
                format: imageFormat,
                extension: imageExtension,
                altText: imageData.altText || ''
              });
            }
          }

          // Save post data to S3 (without image data)
          const postDataForStorage = {
            postId,
            userId,
            text: body.text || '',
            contentLabels: body.contentLabels || [],
            interactionSettings: body.interactionSettings || {
              reply: 'everyone',
              replyOptions: []
            },
            createdAt: new Date().toISOString(),
            imageMetadata: imageMetadata
          };

          const putCommand = new PutObjectCommand({
            Bucket: process.env.POST_DATA_BUCKET,
            Key: `${postId}/post.json`,
            Body: JSON.stringify(postDataForStorage),
            ContentType: 'application/json'
          });
          await s3Client.send(putCommand);

          // Send message to post queue
          const queueMessage = {
            postId,
            userId,
            bucket: process.env.POST_DATA_BUCKET,
            timestamp: new Date().toISOString()
          };

          const sendCommand = new SendMessageCommand({
            QueueUrl: process.env.POST_QUEUE_URL,
            MessageBody: JSON.stringify(queueMessage)
          });
          await sqsClient.send(sendCommand);

          return { statusCode: 200, headers, body: JSON.stringify({ postId, message: 'Post queued successfully' }) };
        } catch (error) {
          console.error('Post creation error:', error);
          return { statusCode: 500, headers, body: JSON.stringify({ error: '投稿に失敗しました' }) };
        }
      } else {
        // Handle settings update
        try {
          if (!event.body) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: '投稿内容は必須です' }) };
          }

          const rawBody = JSON.parse(event.body);
          const body = sanitizeUserInput(rawBody);
          // Log body without sensitive data to avoid large logs and security issues
          const logBody = { ...body };
          if (logBody.images) {
            logBody.images = logBody.images.map((img, i) => ({
              altText: img.altText,
              image: `[IMAGE_DATA_${img.image.length}_BYTES]`
            }));
          }
          if (logBody.blueskyAppPassword) {
            logBody.blueskyAppPassword = '[REDACTED]';
          }
          console.log('Request body:', JSON.stringify(logBody, null, 2));

          console.log('Starting Bluesky validation...');
          const isValid = await validateBlueskyCredentials(body.blueskyUserId, body.blueskyAppPassword);
          if (!isValid) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: 'Invalid Bluesky credentials. Please check your User ID and App Password.' })
            };
          }

          const keyParam = await ssmClient.send(new GetParameterCommand({
            Name: `/${APP_NAME}/${process.env.STAGE}/kms-key-id`
          }));
          const kmsKeyId = keyParam.Parameter.Value;

          const encryptedPassword = await encryptPassword(body.blueskyAppPassword, kmsKeyId);

          // Check if user info already exists and merge
          const existingUserInfo = await getUserInfo(userId);

          const userInfo = {
            blueskyUserId: body.blueskyUserId,
            encryptedBlueskyAppPassword: encryptedPassword,
            provenancePageId: existingUserInfo?.provenancePageId || generateUUID(),
            updatedAt: new Date().toISOString(),
            validatedAt: new Date().toISOString(),
            ...(existingUserInfo && { createdAt: existingUserInfo.createdAt })
          };

          // Set createdAt if this is a new user
          const isNewUser = !existingUserInfo;
          if (isNewUser) {
            userInfo.createdAt = userInfo.updatedAt;
          }

          const putCommand = new PutObjectCommand({
            Bucket: process.env.USER_INFO_BUCKET,
            Key: `${userId}.json`,
            Body: JSON.stringify(userInfo),
            ContentType: 'application/json'
          });

          await s3Client.send(putCommand);

          // Generate empty provenance list for new users
          if (isNewUser) {
            try {
              await generateEmptyProvenanceList(userInfo);
              console.log(`Empty provenance list created for new user: ${userInfo.blueskyUserId}`);
            } catch (error) {
              console.error('Failed to create empty provenance list:', error);
              // Don't fail the entire request if provenance list creation fails
            }
          }

          return { statusCode: 200, headers, body: JSON.stringify({ message: '設定を保存しました' }) };
        } catch (error) {
          console.error('Save settings error:', error);
          return { statusCode: 500, headers, body: JSON.stringify({ error: '設定の保存に失敗しました' }) };
        }
      }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (outerError) {
    console.error('Unexpected error:', outerError);
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};