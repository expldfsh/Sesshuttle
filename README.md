# Sesshuttle

English · [简体中文](README.zh-CN.md)

Continue the same Codex conversation on another computer. Choose a chat on your Mac, upload its encrypted history to your own Cloudflare R2 bucket, then import it on Linux and pick up where you left off. You choose which chats to transfer and when. Sesshuttle supports Codex in the GPT desktop app, CLI and VS Code.

![Select a chat and choose Upload to cloud in the action bar](docs/images/en-upload.png)

## Install

Choose the 0.5.0 package for your computer. Public downloads will be available on [GitHub Releases](https://github.com/expldfsh/Sesshuttle/releases) after publication.

| Platform | Package |
| --- | --- |
| Apple Silicon Mac | `sesshuttle-0.5.0-mac-arm64.dmg` |
| Arch and other x86_64 Linux distributions | `sesshuttle-0.5.0-linux-x64.tar.gz` |
| Debian / Ubuntu x86_64 | `sesshuttle-0.5.0-linux-amd64.deb` |

## Move your first chat from Mac to Linux

1. **Connect both computers.** In Settings on the Mac, create a sync space in your private R2 bucket and export the recovery file. On Linux, import that file and enter your R2 Secret Access Key to join the same space. [Set up R2 and connect both devices](docs/guides/en/quick-start.md#connect-both-devices)
2. **Upload on the Mac.** Click **Refresh**, select your chat, then **Upload to cloud…**. Check the titles, included attachments and estimated upload size. Click **Confirm upload of …** to start. [See the marked confirmation screen](docs/guides/en/quick-start.md#upload-from-the-first-device)
3. **Import on Linux.** Click **Refresh**, select the cloud chat and choose **Import to this computer…**. Pick the Codex app, destination project and local working folder. Review the list and confirm. Once verified, click **Continue**. Keep a local copy of your project files for Codex to work on. [See the import button and setup steps](docs/guides/en/quick-start.md#import-and-continue)
4. **Bring your reply back.** After chatting on Linux, upload the updated chat. On the Mac, refresh and import it into the same app. If both devices changed the chat independently, compare versions before choosing which to import.

## Manage your history

- **Delete chats…** lets you choose this computer, the cloud, or both. Review the affected copies before confirming. Other computers keep their local copies.
- **Sync activity** lets you clear operation records while keeping your chats and sync status.
- **Backups & recovery** lets you create, restore or delete a device backup. Importing and restoring do not create backups automatically.

[Full guide and troubleshooting](docs/guides/en/quick-start.md) · [Validation notes](docs/validation/0.6.0.md)
