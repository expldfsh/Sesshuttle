# Sesshuttle 0.4.0

If your Linux device already shows the cloud chat, go straight to **Import and continue**. Keep the existing space, application data and recovery file when upgrading.

## Install

- On Apple Silicon, open the DMG and drag Sesshuttle into Applications. This local build has no Developer ID signature or notarization.
- On Arch Linux x86_64, run the commands below from the download folder in your graphical desktop session.
- On Debian or Ubuntu x86_64, install `sesshuttle-0.4.0-linux-amd64.deb` using your software installer.

```sh
tar -xzf sesshuttle-0.4.0-linux-x64.tar.gz
./sesshuttle-0.4.0-linux-x64/sesshuttle
```

Install and sign in to the Codex apps you want to use on each device. Bring project files to each device separately. Fonts are bundled.

## Connect both devices

1. In Cloudflare, create a private R2 bucket. Generate R2 credentials with **Object Read & Write** access scoped to that bucket. Save the Access Key ID and Secret Access Key and copy the S3 endpoint shown for your bucket. [Cloudflare setup](https://developers.cloudflare.com/r2/get-started/s3/) · [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/)
2. On the first device, enter these settings in Sesshuttle, create a sync space and export its recovery file. The file holds the space decryption key. Keep it safe.
3. In Settings on the second device, choose **Import a connection file from another computer…**. macOS and Linux both fill in the endpoint, bucket, space and Access Key ID. Enter the R2 Secret Access Key to join. If an older file lacks the ID and this device has no saved ID for that space, export a fresh file from the connected computer.
4. **Connected to your sync space** means the connection succeeded. **View cloud chats** opens the list. A separate memory-only warning means this session can sync, but credentials must be entered again after quitting unless you save them securely.
5. **Remember this connection on this computer** is checked by default. After the space is verified, a locked Linux password store can open its system authorization window. Cancelling leaves you connected for this session. Choose **Remember connection…** to try again. If no provider is available, **Check credential storage** explains how to set one up.

## Upload from the first device

Open a local chat title and click **Upload to cloud…**. For several chats, tick the boxes and review the selected titles in the action bar. Check required parents, optional background sessions, attachments and the estimated additional storage before confirming. If a selection contains blocked chats, review the reasons and confirm the exact eligible count to proceed. Previewing and refreshing leave the cloud history untouched.

To include a readable external image, approve it and update the preview. You can locate another image or accept omissions individually or together for that chat where offered. The imported copy carries the omission notice and retains its text and tool history. Missing required history or an unsafe resource needs repair before a verified import. A 500 MiB per-plan limit is the default. Change the scope or limit in the preview settings when needed.

## Import and continue

1. Open the cloud chat title and choose **Import to this device…**. Select **GPT desktop**, CLI, VS Code or several destinations.
2. Use **Detect local Codex apps** right in the import window. Opening the Codex part of your GPT desktop app first can expose its running runtime and actual history database. Review the evidence and select **Apply selected settings**. Manual paths are shown alongside proposed changes.
3. Choose the project in the destination app, even if it has no chats yet. Select your local working folder or use **Create a dedicated work folder**. The desktop executable such as `/usr/lib/chatgpt/ChatGPT`, its Codex runtime, its history folder and your working folder serve different purposes.
4. Select **Review transfer**, check the destination app and project, then close Codex processes using the history before confirming. The task shows its current stage and reports cloud and per-app results separately. Use **Fix and retry** for an unsuccessful target.
5. Once an entry is verified, open it using **Continue**. If a native link is unavailable, open the destination app yourself and look for the title. Check the old messages and send the first new turn yourself. You can tell Codex you changed machines and give it the new folder. Sesshuttle sets the working directory without adding a model-facing message.
6. Upload the new turn and import it back on the first computer to continue the round trip.

**More actions** includes two-way transfer. Use **Delete chats…** for removal. If both devices edited independently, compare the versions before choosing the one to import.

[Compatibility](../../compatibility/0.4.0.md) · [Verification report](../../validation/0.4.0.md)

## Delete chats and manage recovery copies

1. Open a title or select several chats. Choose **Delete chats…**, then choose **This device only**, **Cloud only**, or **This device and cloud**. Separately choose **Move to recycle bin** or **Delete permanently**. Each new review defaults to recycling.
2. Review device folders, shared apps, dependencies, attachments and retained copies. Cloud versions show the source device, time, size, included histories and attachments. Untick any versions to keep, wait for the review to update, then check which versions will be available afterward.
3. Before the first cloud removal, finish older transfers and upgrade all devices that use the existing space to 0.3.0 or later. Confirming enables the updated space format. The same bucket and recovery key remain in use. Close Codex writers before changing local history.
4. Permanent deletion requires an extra acknowledgement. The final button gives the device chat count and cloud version count. Results are reported per location. If one location fails, review and retry only the unfinished work.
5. **Backups & recovery** has separate device and cloud recycle bins. Choose an entry to restore it or permanently remove the recycled copy. A restored cloud version becomes downloadable. A conflicting new branch stays available for comparison. Previously created safety backups are retained.

Recycling retains the storage. Permanent cleanup releases only unshared objects in the selected space. On another device, imported chats keep working and refresh does not upload them again. An interrupted cloud cleanup can be finished from the cloud bin. If a writer is still recorded on another device, wait for it or reopen the original installation and retry.
