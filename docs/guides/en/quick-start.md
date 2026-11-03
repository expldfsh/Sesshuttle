# Install and connect your R2 storage

sesshuttle 0.1.0-rc.4 is an installation acceptance candidate. Mac isolated checks are complete; real R2, Linux, and native Codex UI acceptance are still pending. See [compatibility](../../compatibility/rc4.md).

## Install

- **Apple Silicon Mac:** open the DMG and drag sesshuttle into Applications. This local candidate has no Developer ID notarization. If macOS blocks it, verify its origin and use the system’s Privacy & Security prompts; do not disable global protection.
- **Debian/Ubuntu x86_64:** install the `.deb` with your software installer, or run `sudo apt install ./sesshuttle-0.1.0-rc.4-linux-amd64.deb` from its folder. Launch sesshuttle from the application menu.
- **Other Linux distributions:** extract `.tar.gz` and run `sesshuttle` inside the folder. A desktop session and Electron system dependencies are required. Linux runtime acceptance is pending. Report startup errors without using `--no-sandbox` or weakening system protection.

Comic Neue and LXGW WenKai are bundled, including their regular and emphasis weights. They work offline without installing fonts on the device.

You do not need Node, Python, Rust, or a development server. Install and sign in to Codex separately on each device. Sync project code separately, for example through Git.

## Configure R2

1. In Cloudflare, open **Storage & databases → R2 → Overview** and create a dedicated private Bucket.
2. Under **API Tokens → Manage**, create R2 credentials with **Object Read & Write**, restricted to that Bucket.
3. Save the Access Key ID and Secret Access Key. Copy the S3 endpoint shown by Cloudflare. A standard endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; jurisdictional Buckets require the corresponding regional endpoint. Do not use a public `r2.dev` URL. [Cloudflare setup](https://developers.cloudflare.com/r2/get-started/s3/), [credentials](https://developers.cloudflare.com/r2/api/tokens/).
4. Enter these values in sesshuttle Settings, test the connection, then create a sync space. No Worker, public domain, CORS rule, or separate database is required.
5. Export the recovery file immediately. It contains the space ID and encryption key, but not your R2 access secret. Keep it safe; lost encryption keys cannot be recovered.

System credential protection stores the key and credentials locally. Linux needs a usable unlocked keyring. When secure storage is unavailable, the app explicitly keeps the connection in memory only. Re-enter credentials and load your recovery file after restarting; plaintext storage is never used as a fallback.

## First upload and second device

On the first device, inspect scan locations (default `~/.codex`), filter Desktop/CLI/VS Code conversations, select completed conversations, and choose **Upload backup**. Review the plan before confirming. Incomplete or unknown formats can be backed up explicitly, but cannot be imported as verified conversations.

On Linux, enter R2 credentials, choose **Join an existing space**, and import the recovery file. Do not create a separate space. Refresh to see cloud versions. In **Projects & entries**, bind each project to the correct Linux working copy and verify target data folders and Codex executables. CLI and VS Code locations are discovered where possible; choose a binary manually if necessary.

## Choose what and where to sync

- **Upload backup:** preserve selected local conversations in R2.
- **Download & import:** restore a cloud version into one or more installed entries.
- **Sync both ways and import locally:** upload local changes and import the resulting version into the selected entries, or import cloud changes. Configure project bindings first.
- For IDE history in every applicable entry, filter **VS Code** and select all installed destinations.
- For Desktop history in IDE and Desktop, filter **Desktop** and select **VS Code + Desktop**.

Close Codex Desktop, CLI sessions, and editor extensions before importing. sesshuttle does not terminate them. Shared storage is copied once, while entry verification results remain separate. A cloud backup does not imply that every entry is ready.

After runtime verification, open the actual native entry and confirm history, attachments, and the working folder before sending a task. No task is sent automatically. Desktop/VS Code automatic opening currently supports the default `~/.codex`; custom homes must be opened with the native app configured for that home.

## Conflicts and recovery

Conflicting branches are preserved. Select a cloud version explicitly; the current local branch and import backup are kept before switching. Versions are never merged automatically or selected by the newest device clock.

For a failed or interrupted import, restore the associated backup before retrying. Recovery restores that folder’s history and index to the backup time and first saves all current data, including newer conversations, in another safety copy. Reopen Codex to verify continuation. Do not delete its database.

Unknown versions, missing resources, wrong keys, storage errors, and unreadable histories stop the affected operation. Share diagnostic error codes and versions, not credentials or private conversation content.

## Mac + Linux acceptance

Use a dedicated test project with different paths on each machine. Create a conversation with an early random marker, several messages, a harmless tool result, and a small image. Upload on Mac, import on Linux, and verify it in native Codex. Check the early marker and run `pwd` plus a read of a Linux-only test file. Add a round on Linux, sync back, and repeat on Mac. Also check repeated imports, multiple destinations, independent branches, backup recovery, wrong keys, English/Chinese switching, and keyring behavior after restarting.

Record the OS, architecture, Codex entry/version, failing step, expected/actual behavior, and error code. These real-device checks remain pending until performed; simulated storage and Mac runtime tests do not replace them.

## History and capacity

Both plain JSONL and Zstandard JSONL histories are recognized, together with native SQLite titles and messages. Main chats and background agents have separate views. Local database sizes are logical record bytes, not shared database page allocations. Auto-detect in Settings or Projects & entries shows paths without overwriting manual choices; explicitly use a result and save. Project bindings refer to local code folders and are not needed for upload-only backup.

Preview stages encrypted chunks locally without uploading history. Check added cloud storage and metadata reserve; the default per-plan upload limit is 500 MiB. Large source data or uploads over 100 MiB require an extra confirmation. Existing versions and incomplete uploads are retained. Both devices should use rc.4; existing R2 settings and recovery files remain valid. Do not recreate the sync space when upgrading.

## Exact scope and attachment approval

Upload backup is the default. Preview lists every included chat with its reason and size. Forks can require earlier history from a parent; optional background descendants are excluded unless selected. Existing screenshots outside the project/Codex folder are listed as awaiting approval, not missing. Approve the individual files and choose **Update preview** before confirming the upload. Missing local images can be individually accepted for import. Unsafe paths, unreadable files, unknown resources and missing required history remain blocked. Native project names and matching reasons are shown independently of each device's working-folder binding.

## Local deletion and recovery

Select local conversations and choose **Delete local conversations**. Inspect the complete chat and file list. Dependencies block removal unless you explicitly include the dependent forks/background sessions. Close Codex, then confirm moving the records into local trash. Shared attachments, project files, R2 versions and other devices are retained. Only dedicated local image attachments are eligible; arbitrary mentioned files and credentials are excluded.

Restore via **Backups & recovery → Local trash**. Restoration preserves unrelated newer conversations and refuses conflicting content at the original paths. Interrupted removal must be recovered before further imports. Trash retains the full recovery data, does not immediately free disk space, and is never emptied automatically. This version has no permanent-empty action. Local changes currently require **Refresh**; there is no automatic background upload.

## Continue without a missing image

In preview, inspect each image path and select **Continue without this image** only for images you accept omitting. Existing external images can instead be approved for inclusion, followed by **Update preview**. Confirmation applies only to the current plan.

Import replaces the confirmed image reference with an explicit text notice in the destination copy. Original backups, message text and tool results remain intact. A verified destination shows **Imported · Some attachments missing**, with Continue available. Supply the image again if its original details are needed. Subsequent transfers preserve omission notices; version synchronization does not mean every attachment is present.

Required parent history, damaged records, unknown formats and security restrictions cannot be waived. Older backups with only generic attachment errors must be inspected and backed up again from the source to obtain individual image reports.
