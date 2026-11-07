import { Menu, nativeTheme, type BrowserWindow } from 'electron';
import { getTheme } from '../shared/themes';

export function updateMenu(language: string | undefined) {
  const zh = language === 'zh-CN';
  const text = (a: string, b: string) => (zh ? a : b);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'sesshuttle',
              submenu: [
                { role: 'about' as const, label: text('关于 sesshuttle', 'About sesshuttle') },
                { type: 'separator' as const },
                { role: 'quit' as const, label: text('退出 sesshuttle', 'Quit sesshuttle') },
              ],
            },
          ]
        : []),
      {
        label: text('编辑', 'Edit'),
        submenu: [
          { role: 'undo', label: text('撤销', 'Undo') },
          { role: 'redo', label: text('重做', 'Redo') },
          { type: 'separator' },
          { role: 'cut', label: text('剪切', 'Cut') },
          { role: 'copy', label: text('复制', 'Copy') },
          { role: 'paste', label: text('粘贴', 'Paste') },
          { role: 'selectAll', label: text('全选', 'Select all') },
        ],
      },
      {
        label: text('窗口', 'Window'),
        submenu: [
          { role: 'minimize', label: text('最小化', 'Minimize') },
          { role: 'close', label: text('关闭', 'Close') },
        ],
      },
    ]),
  );
}

export function updateTheme(window: BrowserWindow | null, themeId: unknown) {
  const theme = getTheme(themeId);
  nativeTheme.themeSource = theme.colorScheme;
  window?.setBackgroundColor(theme.colors.bg);
}

// The native menu and window background follow the saved language and theme.
export function applyAppearance(window: BrowserWindow | null, config: any) {
  updateMenu(config?.language);
  updateTheme(window, config?.theme);
}
