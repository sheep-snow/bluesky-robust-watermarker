// DaisyUI共通UIフレームワーク
const APP_NAME = process.env.APP_NAME || 'brw';

export const getDaisyUIHead = (domainName?: string) => {
  const cssUrl = domainName ? `https://${domainName}/tailwind.min.css` : '/tailwind.min.css';
  return `
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="${cssUrl}" rel="stylesheet" type="text/css" />
`;
};

export const getThemeScript = () => `
  <script>
    // テーマ管理
    const THEMES = [
      'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate', 
      'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween', 'garden',
      'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe', 'black',
      'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade',
      'night', 'coffee', 'winter', 'dim', 'nord', 'sunset'
    ];
    
    function initTheme() {
      const savedTheme = localStorage.getItem('${APP_NAME.toLowerCase()}-theme') || 'cupcake';
      document.documentElement.setAttribute('data-theme', savedTheme);
      const themeSelect = document.getElementById('themeSelect');
      if (themeSelect) {
        themeSelect.value = savedTheme;
      }
    }
    
    function changeTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('${APP_NAME.toLowerCase()}-theme', theme);
    }
    
    // ページ読み込み時にテーマを適用
    document.addEventListener('DOMContentLoaded', initTheme);
  </script>
`;

export const getThemeSelector = () => `
  <div class="dropdown dropdown-end">
    <div tabindex="0" role="button" class="btn btn-ghost btn-circle">
      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"></path>
      </svg>
    </div>
    <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 max-h-96 overflow-y-auto">
      <li class="menu-title">Choose Theme</li>
      <li><a onclick="changeTheme('light')">🌞 Light</a></li>
      <li><a onclick="changeTheme('dark')">🌙 Dark</a></li>
      <li><a onclick="changeTheme('cupcake')">🧁 Cupcake</a></li>
      <li><a onclick="changeTheme('bumblebee')">🐝 Bumblebee</a></li>
      <li><a onclick="changeTheme('emerald')">💎 Emerald</a></li>
      <li><a onclick="changeTheme('corporate')">🏢 Corporate</a></li>
      <li><a onclick="changeTheme('synthwave')">🌆 Synthwave</a></li>
      <li><a onclick="changeTheme('retro')">📻 Retro</a></li>
      <li><a onclick="changeTheme('cyberpunk')">🤖 Cyberpunk</a></li>
      <li><a onclick="changeTheme('valentine')">💝 Valentine</a></li>
      <li><a onclick="changeTheme('halloween')">🎃 Halloween</a></li>
      <li><a onclick="changeTheme('garden')">🌸 Garden</a></li>
      <li><a onclick="changeTheme('forest')">🌲 Forest</a></li>
      <li><a onclick="changeTheme('aqua')">🌊 Aqua</a></li>
      <li><a onclick="changeTheme('lofi')">🎵 Lofi</a></li>
      <li><a onclick="changeTheme('pastel')">🎨 Pastel</a></li>
      <li><a onclick="changeTheme('fantasy')">🦄 Fantasy</a></li>
      <li><a onclick="changeTheme('wireframe')">📐 Wireframe</a></li>
      <li><a onclick="changeTheme('black')">⚫ Black</a></li>
      <li><a onclick="changeTheme('luxury')">💰 Luxury</a></li>
      <li><a onclick="changeTheme('dracula')">🧛 Dracula</a></li>
      <li><a onclick="changeTheme('autumn')">🍂 Autumn</a></li>
      <li><a onclick="changeTheme('business')">💼 Business</a></li>
      <li><a onclick="changeTheme('night')">🌃 Night</a></li>
      <li><a onclick="changeTheme('coffee')">☕ Coffee</a></li>
      <li><a onclick="changeTheme('winter')">❄️ Winter</a></li>
    </ul>
  </div>
`;

export const getNavbar = (currentPage: string = '') => `
  <div class="navbar bg-base-100 shadow-lg">
    <div class="navbar-start">
      <a href="/" class="btn btn-ghost text-xl"> ${APP_NAME}</a>
    </div>
    <div class="navbar-center hidden lg:flex">
      <ul class="menu menu-horizontal px-1">
        <li><a href="/" class="${currentPage === 'home' ? 'active' : ''}">Home</a></li>
        <li><a href="/signup" class="${currentPage === 'signup' ? 'active' : ''}">Sign Up</a></li>
        <li><a href="/login" class="${currentPage === 'login' ? 'active' : ''}">Login</a></li>
        <li><a href="/mypage" class="${currentPage === 'mypage' ? 'active' : ''}">My Page</a></li>
      </ul>
    </div>
    <div class="navbar-end">
      ${getThemeSelector()}
    </div>
  </div>
`;

export const getFooter = () => `
  <footer class="footer footer-center p-10 bg-base-200 text-base-content rounded">
    <nav class="grid grid-flow-col gap-4">
      <a href="/" class="link link-hover">Home</a>
      <a href="/signup" class="link link-hover">Sign Up</a>
      <a href="/login" class="link link-hover">Login</a>
      <a href="/mypage" class="link link-hover">My Page</a>
    </nav>
    <aside>
      <p>© 2025 ${APP_NAME} - Image Provenance Service</p>
    </aside>
  </footer>
`;

export const wrapWithLayout = (title: string, content: string, currentPage: string = '', domainName?: string) => `
  <!DOCTYPE html>
  <html data-theme="cupcake">
  <head>
    <title>${title}</title>
    ${getDaisyUIHead(domainName)}
    ${getThemeScript()}
  </head>
  <body class="min-h-screen flex flex-col">
    ${getNavbar(currentPage)}
    <main class="flex-1 container mx-auto px-4 py-8">
      ${content}
    </main>
    ${getFooter()}
  </body>
  </html>
`;