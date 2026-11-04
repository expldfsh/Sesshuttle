export const zh:Record<string,string>={someImagesMissing:'部分图片未包含',priorMissingImages:'这份历史此前已省略以下图片，本次继续保留缺图说明。',attachment_confirmation_required:'请逐项确认接受未包含的图片，再继续。',acceptMissingImage:'我接受此次不包含这张图片；导入后保留文字并使用缺图说明',missingImageNotice:'文字和必要历史完整时，可确认后继续。未包含的图片无法查看，涉及原图时可能需要重新提供；原始备份保持不变。',imported_missing_attachments:'已导入 · 部分附件缺失',preserveLocal:'导入前保留本机分支',"deleteLocal":"删除本机对话","localTrash":"本机回收站","trashHint":"关闭使用该历史的 Codex 后才能删除。下列记录将移入可恢复回收站；R2 和其他设备的副本保留，不会自动下载回来。","includeDependents":"同时删除依赖这些历史的分支及后台子会话（清单会更新）","trashRetainedSize":"将保留在回收站","trashFiles":"将移入回收站的文件","retainedAttachments":"保留在原位置的附件","trash_shared":"其他对话共用，保留","trash_protected":"项目文件或不属于专用附件目录，保留","trash_missing":"原位置已不存在","moveToTrash":"确认移入本机回收站","trashSpaceHint":"回收站保留恢复所需的完整内容，不会立即释放磁盘，也不会自动清空。本版不提供永久清空。","restoreDeleted":"恢复已删除对话","restoreDeletedConfirm":"先关闭 Codex。仅恢复所选回收站中的对话和附件，保留其他现有记录；遇到同名内容冲突会停止。继续？","trashEmpty":"没有已删除的本机对话","trashDone":"已移入本机回收站，可在“备份与恢复”中恢复。云端副本保留。","trashStatus_removed":"已移入回收站","trashStatus_restored":"已恢复（恢复副本保留）","trashStatus_prepared":"已保存恢复副本","trashStatus_removing":"正在移入回收站","trashStatus_restoring":"正在恢复","trashStatus_needs_recovery":"中断待恢复","trash_dependencies":"其他对话依赖这些历史。请一并选择相关分支/后台会话，或保留原对话。","trash_multiple_homes":"一次只删除一个 Codex 数据目录中的记录。共享多目录的对话请分别处理。","trash_recovery_required":"该目录有未完成的删除，请先在回收站恢复。","trash_needs_recovery":"删除或恢复未完成，完整恢复副本已保留。请在回收站恢复后再操作。","trash_restore_conflict":"原位置已有新增或修改的同名内容，已停止恢复，未覆盖。","locally_removed":"本机已移除，需重新导入验证","history_offsets":"历史分页位置不匹配，已停止导入，原始备份保留。","originProject":"来源项目","allProjects":"全部项目","unassignedProject":"未识别项目","ambiguousProject":"项目归属待确认","projectMatch_id":"原生项目关联","projectMatch_root":"匹配原生项目目录","projectMatch_backing_root":"匹配桌面项目绑定","projectMatch_ambiguous":"多个项目使用同一目录","projectMatch_directory":"仅根据工作目录显示","includeDescendants":"包含所选对话的后台子会话（预览中逐条列出）","clearSelection":"清除选择","hiddenSelection":"当前筛选之外仍已选中","directSelections":"条直接选择","actualScope":"条实际传输的对话","selectedChat":"已勾选","requiredParent":"必需的父对话","selectedDescendant":"已选择包含的子会话","backupMember":"云端备份内的会话","localDestination":"导入本机位置","approveAttachment":"同意随本次备份包含这个外部附件","attachment_included":"已包含","attachment_approval_required":"文件存在，等待授权包含","attachment_missing":"图片文件不存在，可逐项确认不包含","attachment_unsupported":"附件格式不支持","attachment_unsafe":"附件是链接或共享硬链接，未读取","attachment_unreadable":"附件无法读取，请检查权限","attachment_approval":"外部附件文件存在，请逐项确认是否包含","rebuildHint":"附件选择已更改，请更新预览以重新计算大小。","rebuildPreview":"更新预览","planBlockedHint":"请先处理以上条目；未开始上传或导入。","confirmUpload":"确认并上传所列对话",projectedCloud:'本次完成后的空间占用上限',uploadPreviewHint:'只上传加密备份，不向本机 Codex 导入。确认容量和选择后再开始。',compressedHistory:'压缩历史（已识别）',expandedSize:'展开后的历史大小',missing_rollout:'仅有本地数据库记录，缺少 Codex 继续所需的原始历史文件。可完整备份；暂不能导入原生入口继续。',"main":"主对话","mainChats":"主对话","backgroundChats":"后台子会话","localSize":"本地历史大小","hasLocalDatabase":"含本地数据库记录","fileSize":"本地历史文件","databaseSize":"本地数据库记录","parentChat":"所属主对话","sizeHint":"数据库显示该对话记录的逻辑大小，未分摊共享索引和空闲页。同步预览会列出已选关联对话与附件。","uploadLimit":"本次上传上限（MiB）","cloudUsage":"当前同步空间占用","newUpload":"去重后新增加密数据","metadataReserve":"元数据预留","uploadUpperBound":"预计新增空间上限","quotaHint":"仅统计当前同步空间，不是整个 Bucket 的配额。保留的旧版本和未完成上传也占空间；其他设备可能同时上传。","confirmLarge":"我已检查容量，同意本次大批量上传","upload_limit":"超过本次上传上限，已阻止上传。调整上限或减少选择后重新预览。","large_upload_confirmation":"请先确认本次大批量上传。","blocked":"无法执行","history_unavailable":"发现对话索引，但没有可读取的本地历史内容。","database_schema":"目标 Codex 数据库结构暂不兼容；原始备份已保留。","record_too_large":"单条记录超过安全解析上限，可见但暂无法导入。","disk_space":"本地剩余空间不足，已停止写入。","detectPaths":"自动检测","detectHint":"只检测路径，不读取或复制登录密钥。点击“使用此路径”才更新填写值，保存后生效。","pathFound":"已找到","pathMissing":"不可用 / 未找到","useDetected":"使用此路径","currentPath":"当前配置","projectMappingHint":"绑定当前电脑的代码文件夹，用于导入后继续开发；只上传备份不需要绑定。",
 unsafe_native_config:'无法确认原生工具与启动钩子已关闭，导入验证已停止。',recoveryLoaded:'恢复文件已载入，无需再次填写恢复密钥。',recoverySaved:'恢复文件已保存，请妥善保管。',confirm:'确认',retryEntry:'只重试此入口',upload_import:'上传并导入所选入口',historyFiles:'份历史记录',attachments:'个附件',brandTagline:'让上下文随你同行',workContext:'保留工作上下文',workspace:'工作空间',you:'你',tool:'工具',importVersion:'导入版本',closePending:'正在安全暂停。当前条目完成后可以关闭窗口。',terminal_required:'未找到终端应用，请安装常用终端后重试。',custom_home_launcher:'此入口使用自定义数据目录，请用配置该目录的原生应用打开对话。',recovery_required:'此前导入中断，请先恢复关联备份，再重新导入。',interrupted:'已中断待处理',conversations:'对话',projects:'项目与入口',settings:'设置',backups:'备份与恢复',activity:'同步记录',subtitle:'在另一台电脑，接着做。',all:'全部',desktop:'Desktop',cli:'CLI',ide:'VS Code',unknown:'来源未知',subagent:'后台子会话',refresh:'刷新',search:'搜索标题或项目…',sync:'预览同步',selected:'已选',selectAll:'选择当前范围',title:'对话',source:'来源',status:'同步状态',updated:'更新时间',details:'对话详情',history:'历史预览',noHistory:'选择一条对话查看详情',noMessages:'云端对话将在下载后显示历史预览',local:'本机',cloud:'云端',offline:'尚未连接云端',connectHint:'连接自己的 R2 存储，即可比较差异和同步。',configure:'配置存储',lastCheck:'上次检查',empty:'这里还没有对话',emptyHint:'检查 Codex 数据位置，或刷新云端历史。',archive:'已归档',bytes:'大小',sourceDevice:'来源设备',entryStates:'各入口状态',notImported:'尚未导入',continue:'继续',close:'关闭',cancel:'取消',save:'保存设置',saved:'已保存',saving:'处理中…',direction:'同步方向',upload:'上传备份',download:'下载导入',both:'双向同步并导入本机',targets:'导入到本机入口',allTargets:'选择全部入口',scopeHint:'“全部对话”决定同步内容，“全部入口”决定导入位置。共享历史只写入一份。',incomplete:'允许仅备份不完整对话（不代表可续聊）',preview:'确认同步计划',previewHint:'导入前会自动备份。请先退出使用目标数据目录的 Codex 应用。',confirmSync:'确认并开始',action:'操作',skip:'跳过',resolve:'选择分支',preserve_conflict:'保留分歧',busy:'使用中',conflict:'两边均有修改',conflict_preserved:'双方分支已保留',local_only:'仅本机存在',remote_only:'仅云端存在',local_changes:'本机有更新',remote_changes:'云端有更新',synced:'已同步',unchecked:'尚未比较',pending:'待处理',verified:'内核已验证',imported:'已导入待验证',already_imported:'已存在',not_configured:'入口未配置',failed:'失败',partial:'部分完成',uploaded:'已备份',downloaded:'已导入',running:'进行中',completed:'已完成',attention:'有待处理项',paused:'已暂停',pause:'在当前条目后暂停',retryHint:'重新选择失败的对话和入口，即可预览并重试。',versions:'云端历史版本',useVersion:'将此版本导入所选入口',versionHint:'使用历史版本前会保留本机分支。其他云端版本仍可恢复。',projectPath:'本机项目目录',bind:'选择文件夹',projectHint:'为每个项目选择本机的正确工作副本。绑定只保存在这台设备。',noProjects:'扫描或连接云端后，项目会出现在这里。',entryHint:'多个入口可以使用同一个 Codex 数据目录。同步时分别验证入口，不重复复制历史。',dataHome:'Codex 数据目录',binary:'Codex 可执行文件',browse:'选择',language:'界面语言',deviceName:'设备名称',device:'当前设备',localSettings:'本机设置',sourceHomes:'扫描位置（每行一个）',storage:'自有云端存储',storageHint:'R2 Bucket 用于保存加密历史，无需额外部署数据库。凭据不会随对话同步。',endpoint:'R2 S3 地址',bucket:'Bucket 名称',accessKey:'Access Key ID',secretKey:'Secret Access Key',test:'测试连接',create:'创建新同步空间',join:'加入已有空间',connectCreate:'连接并创建空间',connectJoin:'连接并加入空间',space:'同步空间 ID',recoveryKey:'恢复密钥',importKey:'导入恢复文件',exportKey:'导出恢复文件',keyHint:'请将恢复文件另存到安全位置。新电脑加入时需要它；丢失后无法恢复云端历史。',connected:'已连接',disconnect:'断开连接',disconnectHint:'仅断开连接，本机和云端历史均保留。',security:'数据保护',securityText:'正文、标题、项目路径在上传前加密。默认无遥测。不读取登录配置和凭据文件；对话中的文字会随历史加密备份。',backupsHint:'每次导入前保存原数据。恢复前请退出 Codex；恢复也会先保存当前数据。',noBackups:'还没有导入备份',restore:'恢复此备份',restoreConfirm:'该目录的历史和索引将恢复到备份时的状态。恢复前会另存当前全部数据的安全副本，之后新增的对话也保留在副本中。确认继续？',restoreDone:'备份已恢复，请重新打开 Codex 验证。',createdAt:'创建时间',files:'文件',noJobs:'还没有同步任务',issues:'需要处理',diagnostics:'诊断预览',diagnosticHint:'仅包含版本、平台、任务状态和错误码，不包含对话或凭据。',copy:'复制',nativeHint:'内核验证通过后仍需在实际入口确认显示。软件不会自动发送任务。',recentMessages:'预览最近的消息；同步会保留完整原始历史。',gitInfo:'查看本机 Git 状态',branch:'分支',commit:'提交',changes:'未提交文件',noGit:'普通项目文件夹',chooseProject:'请先绑定本机项目目录',loading:'正在读取…',testMode:'隔离测试环境',cloudStale:'云端检查失败，显示上次成功结果。恢复连接后才能同步。',scanErrors:'部分记录未能读取，请检查数据目录；未将它们标为已同步。',nativeConfirm:'将打开所选原生入口，不发送新任务。请确认本机项目目录和代码版本。',readOnlyNotice:'导入后以只读权限验证。继续工作时遵循目标 Codex 的审批设置。',notVerified:'未验证',noSelection:'先选择需要同步的对话',unknown_version:'当前 Codex 版本尚未通过导入验证，可选择仅备份。',external_image:'包含外部图片引用，暂不能验证完整接续。',remote_resource:'包含未随历史保存的远端资源。',external_attachment:'附件不在项目或 Codex 目录内、已缺失或格式不受支持。',duplicate_identity:'发现相同会话 ID 的不同本机副本，请分别处理。',missing_dependency:'缺少关联子会话或父会话。',invalid_history:'历史格式无法完整读取。',file_too_large:'单项数据超过本版处理上限。',invalid_path:'请选择有效的绝对路径。',unsafe_path:'路径包含链接或超出允许范围，操作已停止。',stale_plan:'预览后数据或设置发生变化，请刷新并重新预览。',invalid_key:'恢复密钥格式无效。',decrypt_failed:'无法解密：请检查密钥，或确认云端数据完整。',corrupt_data:'数据完整性校验失败，未导入。',concurrent_update:'其他设备正在更新云端，请刷新后重试。',storage_permission:'无法读取存储，请检查凭据和 Bucket 权限。',storage_write_permission:'存储没有写入或删除测试对象的权限。',storage_unavailable:'暂时无法连接存储，请检查网络和地址。',invalid_endpoint:'请输入 Cloudflare R2 的 HTTPS S3 地址。',invalid_bucket:'Bucket 名称格式无效。',space_too_large:'同步空间超过本版处理上限。',space_not_found:'未找到此同步空间，请检查 Bucket 和空间 ID。',invalid_space:'同步空间格式不匹配。',missing_remote_object:'云端版本缺少数据对象。',codex_running:'请先退出正在运行的 Codex 桌面、CLI 和编辑器扩展，再重试导入。',process_check_failed:'无法确认 Codex 是否已退出，已停止写入。',binary_required:'请配置目标入口的 Codex 可执行文件。',binary_unavailable:'无法运行所选 Codex 可执行文件。',native_error:'Codex 未能完成本机验证。',native_unavailable:'无法启动目标 Codex 内核。',native_timeout:'Codex 验证超时，请重试或恢复备份。',native_verification_failed:'目标入口尚未通过历史与目录验证。',backup_too_large:'备份数据超过本版上限，未修改历史。',backup_not_found:'未找到备份。',corrupt_backup:'备份校验失败，未恢复。',import_needs_recovery:'导入未完成，请在“备份与恢复”查看并恢复对应备份。',incomplete_history:'关键历史不完整或包含尚未支持的资源，暂不能导入。',scan_incomplete:'目标目录含不可读历史，已停止导入。',task_running:'请等待当前任务完成或暂停。',storage_not_connected:'请先连接云端存储。',cloud_check_failed:'请先成功刷新云端状态。',invalid_selection:'请选择有效的对话与同步选项。',target_required:'请至少选择一个导入目标。',project_required:'请在“项目与入口”绑定本机项目目录。',invalid_settings:'请检查设置内容。',secure_storage_unavailable:'系统凭据保护不可用。本次连接仅保留在内存中，重启后需重新填写；不会明文保存。',credentials_required:'请输入存储访问凭据。',not_verified:'此入口尚未验证，无法直接继续。',open_failed:'无法打开入口，请检查是否已安装。',manual_cli_required:'请在已绑定项目目录中使用 Codex CLI 恢复该会话。',operation_failed:'操作未完成，请检查设置后重试。',invalid_action:'无效操作。',test_mode:'隔离测试模式不会保存真实凭据。',restored_needs_validation:'已恢复待验证',empty_state:'无数据'
};
export const en:Record<string,string>={...zh,someImagesMissing:'Some images are not included',priorMissingImages:'These images were omitted in an earlier import. Their omission notices are preserved.',attachment_confirmation_required:'Confirm each omitted image before continuing.',acceptMissingImage:'Continue without this image; keep text and show an omission notice after import',missingImageNotice:'You can continue when text and required history are intact. Omitted images will be unavailable and may need to be supplied again. Original backups remain unchanged.',imported_missing_attachments:'Imported · Some attachments missing',preserveLocal:'Preserve local branch before import',"deleteLocal":"Delete local conversations","localTrash":"Local trash","trashHint":"Close Codex before removing history. Listed records move to recoverable local trash. R2 and other devices keep their copies; nothing is downloaded automatically.","includeDependents":"Also remove dependent forks and background sessions (updates the list)","trashRetainedSize":"will be retained in trash","trashFiles":"Files to move to trash","retainedAttachments":"Attachments kept at their original location","trash_shared":"Shared with other conversations; kept","trash_protected":"Project file or outside a dedicated attachment folder; kept","trash_missing":"No longer at the original path","moveToTrash":"Confirm move to local trash","trashSpaceHint":"Trash retains complete recovery data and does not immediately free disk space. It is never emptied automatically. Permanent emptying is not available in this version.","restoreDeleted":"Restore deleted conversations","restoreDeletedConfirm":"Close Codex first. Restore only these deleted conversations and attachments while keeping other records. Conflicting existing content will stop restoration. Continue?","trashEmpty":"No deleted local conversations","trashDone":"Moved to local trash. Restore from Backups & recovery. Cloud copies are retained.","trashStatus_removed":"In trash","trashStatus_restored":"Restored (recovery copy retained)","trashStatus_prepared":"Recovery copy saved","trashStatus_removing":"Moving to trash","trashStatus_restoring":"Restoring","trashStatus_needs_recovery":"Interrupted; restore required","trash_dependencies":"Other conversations depend on this history. Include the dependent forks/background sessions, or keep the original conversation.","trash_multiple_homes":"Remove records from one Codex folder at a time. Conversations shared across folders require separate handling.","trash_recovery_required":"Restore the interrupted removal for this folder first.","trash_needs_recovery":"Removal or restoration did not finish. Recovery data is retained. Restore from local trash before continuing.","trash_restore_conflict":"New or changed content occupies the original location. Restoration stopped without overwriting it.","locally_removed":"Removed locally; import and verify again","history_offsets":"History pagination offsets do not match. Import stopped; the original backup is retained.","originProject":"Source project","allProjects":"All projects","unassignedProject":"Unassigned project","ambiguousProject":"Ambiguous project","projectMatch_id":"Native project link","projectMatch_root":"Matched native project folder","projectMatch_backing_root":"Matched desktop project backing","projectMatch_ambiguous":"Multiple projects share this folder","projectMatch_directory":"Based on working folder","includeDescendants":"Include background descendants (listed individually in preview)","clearSelection":"Clear selection","hiddenSelection":"Selected outside this filter","directSelections":"directly selected","actualScope":"conversations in the transfer","selectedChat":"Selected","requiredParent":"Required parent","selectedDescendant":"Included descendant","backupMember":"Member of cloud backup","localDestination":"Import on this computer","approveAttachment":"Include this external attachment in this backup","attachment_included":"Included","attachment_approval_required":"File found; inclusion needs approval","attachment_missing":"Image file is missing; confirm to continue without it","attachment_unsupported":"Unsupported attachment format","attachment_unsafe":"Linked attachment rejected","attachment_unreadable":"Attachment unreadable; check permissions","attachment_approval":"External attachments exist; approve each one to include it","rebuildHint":"Attachment selection changed. Update preview to recalculate size.","rebuildPreview":"Update preview","planBlockedHint":"Resolve the items above before uploading or importing.","confirmUpload":"Confirm and upload listed conversations",projectedCloud:'Space usage upper bound after this plan',uploadPreviewHint:'Upload encrypted backups only. No local Codex import. Check capacity and selection before starting.',compressedHistory:'Compressed history detected',expandedSize:'Uncompressed history size',missing_rollout:'Local database records are preserved, but the original rollout required by Codex is missing. Full backup is available; native import and continuation are unavailable.',"main":"Main chats","mainChats":"Main chats","backgroundChats":"Background sessions","localSize":"Local history size","hasLocalDatabase":"Includes local database","fileSize":"Local history files","databaseSize":"Local database records","parentChat":"Parent chat","sizeHint":"Database size is logical record data, excluding shared indexes and free pages. Sync preview also includes related sessions and attachments.","uploadLimit":"Upload limit for this plan (MiB)","cloudUsage":"Current sync space usage","newUpload":"New encrypted data after deduplication","metadataReserve":"Metadata reserve","uploadUpperBound":"Estimated added-space upper bound","quotaHint":"This is this sync space, not the whole Bucket quota. Old versions and unfinished uploads also use space; other devices may upload concurrently.","confirmLarge":"I have checked capacity and approve this large upload","upload_limit":"Upload limit exceeded. Reduce selection or change the limit and preview again.","large_upload_confirmation":"Confirm this large upload first.","blocked":"Blocked","history_unavailable":"Chat index found, but no readable local history content.","database_schema":"Target Codex database schema is not compatible. Original backup is preserved.","record_too_large":"A single record exceeds the safe parsing limit; import is unavailable.","disk_space":"Insufficient local disk space. Writes stopped.","detectPaths":"Auto-detect","detectHint":"Detects paths without reading or copying login keys. Use a path explicitly, then save to apply.","pathFound":"Found","pathMissing":"Unavailable / not found","useDetected":"Use this path","currentPath":"Current setting","projectMappingHint":"Bind this computer’s code folder to continue after import. Upload-only backups do not need a binding.",
 unsafe_native_config:'Native tools and startup hooks could not be disabled. Import verification stopped.',recoveryLoaded:'Recovery file loaded. You do not need to enter the key again.',recoverySaved:'Recovery file saved. Keep it somewhere safe.',confirm:'Confirm',retryEntry:'Retry this entry',upload_import:'Upload & import selected entries',historyFiles:'history files',attachments:'attachments',brandTagline:'YOUR CONTEXT, EVERYWHERE',workContext:'YOUR WORK, IN CONTEXT',workspace:'WORKSPACE',you:'You',tool:'Tool',importVersion:'Imported version',closePending:'Pausing safely. Close the window after the current item finishes.',terminal_required:'Install a terminal application before opening CLI conversations.',custom_home_launcher:'This entry uses a custom data folder. Open the native app configured for that folder.',recovery_required:'A previous import was interrupted. Restore its backup before importing again.',interrupted:'Interrupted',conversations:'Conversations',projects:'Projects & entries',settings:'Settings',backups:'Backups & recovery',activity:'Sync activity',subtitle:'Pick up where you left off.',all:'All',desktop:'Desktop',cli:'CLI',ide:'VS Code',unknown:'Unknown origin',subagent:'Background sessions',refresh:'Refresh',search:'Search titles or projects…',sync:'Preview sync',selected:'selected',selectAll:'Select this view',title:'Conversation',source:'Origin',status:'Sync status',updated:'Last updated',details:'Conversation details',history:'History preview',noHistory:'Select a conversation',noMessages:'Download to preview cloud history',local:'Local',cloud:'Cloud',offline:'Cloud not connected',connectHint:'Connect your R2 storage to compare and sync conversations.',configure:'Set up storage',lastCheck:'Last checked',empty:'No conversations here yet',emptyHint:'Check your Codex data location or refresh cloud history.',archive:'Archived',bytes:'Size',sourceDevice:'Source device',entryStates:'Status by entry',notImported:'Not imported',continue:'Continue',close:'Close',cancel:'Cancel',save:'Save settings',saved:'Saved',saving:'Working…',direction:'Sync direction',upload:'Upload backup',download:'Download & import',both:'Sync both ways and import locally',targets:'Import into local entries',allTargets:'Select all entries',scopeHint:'Conversations select the content. Entries select the destination. Shared history is written once.',incomplete:'Allow backup of incomplete conversations (continuation is not verified)',preview:'Review sync plan',previewHint:'Imports are backed up first. Close Codex apps using the destination before importing.',confirmSync:'Confirm and start',action:'Action',skip:'Skip',resolve:'Select branch',preserve_conflict:'Preserve both branches',busy:'In use',conflict:'Conflicting changes',conflict_preserved:'Both branches preserved',local_only:'Local only',remote_only:'Cloud only',local_changes:'Local changes',remote_changes:'Cloud changes',synced:'Up to date',unchecked:'Not compared',pending:'Needs attention',verified:'Runtime verified',imported:'Imported, verify entry',already_imported:'Already present',not_configured:'Entry not configured',failed:'Failed',partial:'Partially completed',uploaded:'Backed up',downloaded:'Imported',running:'In progress',completed:'Completed',attention:'Needs attention',paused:'Paused',pause:'Pause after current item',retryHint:'Select the failed conversations and entries to preview and retry.',versions:'Cloud versions',useVersion:'Import this version into selected entries',versionHint:'Your local branch is preserved before switching. Other cloud versions remain recoverable.',projectPath:'Local project folder',bind:'Choose folder',projectHint:'Bind each project to the correct local working copy. Bindings stay on this device.',noProjects:'Projects appear after scanning or connecting cloud storage.',entryHint:'Entries can share a Codex data folder. Each is checked individually without duplicating history.',dataHome:'Codex data folder',binary:'Codex executable',browse:'Choose',language:'Language',deviceName:'Device name',device:'This device',localSettings:'Local settings',sourceHomes:'Scan locations (one per line)',storage:'Your cloud storage',storageHint:'An R2 Bucket stores encrypted history. No separate database is needed. Credentials are never synced.',endpoint:'R2 S3 endpoint',bucket:'Bucket name',accessKey:'Access Key ID',secretKey:'Secret Access Key',test:'Test connection',create:'Create a sync space',join:'Join an existing space',connectCreate:'Connect & create space',connectJoin:'Connect & join space',space:'Sync space ID',recoveryKey:'Recovery key',importKey:'Import recovery file',exportKey:'Export recovery file',keyHint:'Keep the recovery file somewhere safe. New devices need it; lost keys cannot be recovered.',connected:'Connected',disconnect:'Disconnect',disconnectHint:'Local and cloud history will be kept.',security:'Data protection',securityText:'Content, titles and paths are encrypted before upload. No telemetry by default. Login configuration and credential files are excluded; text within conversations is encrypted with the history.',backupsHint:'Original data is saved before import. Close Codex before recovery; recovery also preserves the current state.',noBackups:'No import backups yet',restore:'Restore backup',restoreConfirm:'Restore this folder’s history and index to the backup time? All current data, including conversations added later, will be kept in a safety copy.',restoreDone:'Backup restored. Reopen Codex to verify it.',createdAt:'Created',files:'files',noJobs:'No sync activity yet',issues:'Needs attention',diagnostics:'Preview diagnostics',diagnosticHint:'Only versions, platform, task states and error codes. No conversation content or credentials.',copy:'Copy',nativeHint:'Verify visibility in the actual entry after runtime checks. No task is submitted automatically.',recentMessages:'Preview shows recent messages; sync preserves the complete original history.',gitInfo:'Inspect local Git state',branch:'Branch',commit:'Commit',changes:'Uncommitted files',noGit:'Regular project folder',chooseProject:'Bind a local project folder first',loading:'Loading…',testMode:'Isolated test environment',cloudStale:'Cloud check failed. Showing the last successful result. Reconnect before syncing.',scanErrors:'Some records could not be read. They are not marked as synced.',nativeConfirm:'Open this native entry without submitting a task? Confirm your local project folder and code version.',readOnlyNotice:'Imports are checked with read-only permissions. Work continues under the target Codex approval settings.',notVerified:'Not verified',noSelection:'Select conversations to sync first',unknown_version:'This Codex version is not validated for import. Backup is available.',external_image:'An external image reference prevents verified continuation.',remote_resource:'History references a remote resource that was not captured.',external_attachment:'An attachment is missing, outside the project/Codex folder, or unsupported.',duplicate_identity:'Different local copies share a conversation ID. Resolve them separately.',missing_dependency:'A required parent or sub-session is missing.',invalid_history:'History could not be read completely.',file_too_large:'Data exceeds this version’s size limit.',invalid_path:'Choose a valid absolute path.',unsafe_path:'A linked or out-of-scope path was rejected.',stale_plan:'Data or settings changed after preview. Refresh and preview again.',invalid_key:'Invalid recovery key.',decrypt_failed:'Decryption failed. Check the key and data integrity.',corrupt_data:'Integrity check failed. Nothing was imported.',concurrent_update:'Another device updated the cloud. Refresh and retry.',storage_permission:'Storage access denied. Check credentials and Bucket permissions.',storage_write_permission:'Storage write or test-object deletion permission is missing.',storage_unavailable:'Storage is unavailable. Check network and endpoint.',invalid_endpoint:'Enter a Cloudflare R2 HTTPS S3 endpoint.',invalid_bucket:'Invalid Bucket name.',space_too_large:'The space exceeds this version’s limit.',space_not_found:'Sync space not found. Check Bucket and space ID.',invalid_space:'Unsupported sync space.',missing_remote_object:'A cloud version is missing a data object.',codex_running:'Close Codex Desktop, CLI and editor extensions before importing.',process_check_failed:'Cannot verify Codex has exited. Writes were stopped.',binary_required:'Configure the target Codex executable.',binary_unavailable:'Cannot run the selected Codex executable.',native_error:'Codex could not verify the import.',native_unavailable:'Cannot start the target Codex runtime.',native_timeout:'Codex verification timed out. Retry or restore the backup.',native_verification_failed:'Target history and folder verification failed.',backup_too_large:'Backup exceeds the limit. History was not changed.',backup_not_found:'Backup not found.',corrupt_backup:'Backup validation failed. Nothing was restored.',import_needs_recovery:'Import did not finish. Open Backups & recovery to restore the associated backup.',incomplete_history:'This format or resource is not supported for import. Backup only is available.',scan_incomplete:'Unreadable destination history prevents a safe import.',task_running:'Wait for the current task or pause it.',storage_not_connected:'Connect cloud storage first.',cloud_check_failed:'Refresh cloud status successfully first.',invalid_selection:'Choose valid conversations and sync options.',target_required:'Choose at least one destination.',project_required:'Bind a local folder in Projects & entries.',invalid_settings:'Check your settings.',secure_storage_unavailable:'System credential protection is unavailable. This connection stays in memory only; enter credentials again after restarting.',credentials_required:'Enter storage credentials.',not_verified:'This entry has not been verified.',open_failed:'Could not open the installed entry.',manual_cli_required:'Resume this conversation with Codex CLI in the bound project folder.',operation_failed:'The operation failed. Check settings and retry.',invalid_action:'Invalid action.',test_mode:'Test mode does not persist real credentials.',restored_needs_validation:'Restored, verification needed',empty_state:'No data'
};

const workflowLabels: Record<string,[string,string]> = {
 "projects": [
  "本机应用与项目",
  "Apps & projects"
 ],
 "working": [
  "正在处理当前操作…",
  "Working on this action…"
 ],
 "stageCheck": [
  "正在核对所选版本…",
  "Checking selected versions…"
 ],
 "stageUpload": [
  "正在上传到云端…",
  "Uploading to cloud…"
 ],
 "stageDownload": [
  "正在下载并校验历史…",
  "Downloading and checking history…"
 ],
 "stageBackup": [
  "正在备份本机历史…",
  "Backing up local history…"
 ],
 "stageWrite": [
  "正在写入本机历史…",
  "Writing local history…"
 ],
 "stageVerify": [
  "正在验证原生入口及项目归属…",
  "Verifying runtime and project assignment…"
 ],
 "taskResult": [
  "本次任务",
  "Current task"
 ],
 "transferFinished": [
  "同步任务已完成",
  "Transfer complete"
 ],
 "fixAndRetry": [
  "修复并重试",
  "Fix and retry"
 ],
 "collapseDetails": [
  "收起详情",
  "Hide details"
 ],
 "uploadCloud": [
  "上传到云端",
  "Upload to cloud"
 ],
 "importLocal": [
  "导入到本机",
  "Import to this device"
 ],
 "moreActions": [
  "更多操作",
  "More actions"
 ],
 "compareVersions": [
  "比较并选择版本",
  "Compare versions"
 ],
 "selectedScope": [
  "本次范围",
  "Selected scope"
 ],
 "checkingEntries": [
  "正在检测本机应用与项目…",
  "Checking local apps and projects…"
 ],
 "preparingPreview": [
  "正在生成清单，尚未上传或导入…",
  "Preparing preview. Nothing has been uploaded or imported…"
 ],
 "reviewAction": [
  "查看本次清单",
  "Review transfer"
 ],
 "chooseApp": [
  "选择打开对话的应用",
  "Choose where to open the chat"
 ],
 "localProject": [
  "选择本机项目",
  "Choose a local project"
 ],
 "destinationProject": [
  "导入到本机项目",
  "Destination project"
 ],
 "selectedDestination": [
  "将关联到",
  "Assign to"
 ],
 "chooseDestination": [
  "请选择原生项目或仅导入历史",
  "Choose a project or local history only"
 ],
 "chooseMatching": [
  "选择同名项目",
  "Choose matching project"
 ],
 "historyOnly": [
  "仅导入本机历史",
  "Import to local history only"
 ],
 "historyOnlyHint": [
  "仅导入历史时，仍可验证续聊；请在原生应用的对话列表中查找。",
  "History-only imports can still be verified. Look in the app’s chat list."
 ],
 "workingFolderHint": [
  "在这台电脑上继续工作时使用的文件夹",
  "Folder to work in on this device"
 ],
 "createWorkingFolder": [
  "创建并使用专用工作目录",
  "Create a dedicated work folder"
 ],
 "chooseFolder": [
  "正在选择工作目录…",
  "Choosing a work folder…"
 ],
 "checkAgain": [
  "重新检查",
  "Check again"
 ],
 "checkingStorage": [
  "正在检查凭据存储…",
  "Checking credential storage…"
 ],
 "detectEnvironment": [
  "检测本机 Codex 环境",
  "Detect local Codex apps"
 ],
 "detectApplyHint": [
  "选中需要采用的配置，点击下方按钮一次保存。采用的历史目录也会加入扫描位置。",
  "Select the settings to apply and save them together. Selected history folders are also added to scan locations."
 ],
 "kernelProgram": [
  "Codex 内核程序",
  "Codex runtime"
 ],
 "kernelMeaning": [
  "该应用用来读取、继续对话的可执行文件。",
  "The executable this app uses to load and resume chats."
 ],
 "historyFolder": [
  "Codex 历史目录",
  "Codex history folder"
 ],
 "historyMeaning": [
  "该应用存放会话和索引的目录，通常是 .codex。",
  "Where this app stores its chats and indexes, commonly .codex."
 ],
 "desktopApp": [
  "桌面主程序",
  "Desktop application"
 ],
 "liveDatabase": [
  "运行中内核实际打开的历史库",
  "History database opened by the running app"
 ],
 "liveEnvironment": [
  "运行中内核的 CODEX_HOME",
  "Running app’s CODEX_HOME"
 ],
 "liveBinary": [
  "运行中内核，历史目录待核对",
  "Running app; check the history folder"
 ],
 "installedBinary": [
  "安装位置",
  "Installation path"
 ],
 "savedPath": [
  "已填写的路径",
  "Saved path"
 ],
 "configured": [
  "可使用",
  "Ready"
 ],
 "suggested": [
  "建议新增",
  "Suggested addition"
 ],
 "replaceSaved": [
  "将替换已有路径",
  "Replaces your saved path"
 ],
 "checkProposedFolder": [
  "请核对建议的目录",
  "Check the suggested folder"
 ],
 "launchDesktopToDetect": [
  "还没识别到桌面内核。打开 GPT 桌面端的 Codex 页面后重新检测，或手动选择内核。",
  "Desktop runtime not identified. Open Codex in your desktop app and detect again, or choose its runtime manually."
 ],
 "noCandidate": [
  "未找到可用程序。可在应用卡片中手动选择。",
  "No runtime found. Choose it manually in the app card."
 ],
 "applySelected": [
  "应用所选配置",
  "Apply selected settings"
 ],
 "applying": [
  "正在保存配置…",
  "Saving settings…"
 ],
 "needsCheck": [
  "待检查",
  "Needs checking"
 ],
 "resolveEntry": [
  "请先补齐所选应用下方标出的路径，再点重新检查。",
  "Complete the indicated paths for the selected app, then check again."
 ],
 "entry_binary_missing": [
  "尚未配置内核程序。请检测环境或选择 Codex 可执行文件。",
  "Runtime missing. Detect the app or choose its Codex executable."
 ],
 "entry_home_missing": [
  "找不到历史目录。请启动该应用一次，或选择已有的数据目录。",
  "History folder missing. Open the app once or choose its existing data folder."
 ],
 "project_assignment_unsupported": [
  "此内核尚未验证原生项目归属。请选择仅导入历史，或使用已支持的入口。",
  "Project assignment is unverified for this runtime. Select history only or a supported app."
 ],
 "destination_project_missing": [
  "目标原生项目已变化。请重新检测并选择本机项目。",
  "Destination project changed. Detect again and choose a local project."
 ],
 "project_assignment_failed": [
  "历史归属验证失败。打开备份与恢复检查本次导入。",
  "Project verification failed. Review this import in Backups & recovery."
 ],
 "working_folder_missing": [
  "工作目录不存在。请选择本机已有目录，或创建专用目录。",
  "Working folder unavailable. Choose an existing local folder or create one."
 ],
 "project_required": [
  "请选择本机工作目录，或创建专用工作目录。",
  "Choose a local working folder or create a dedicated folder."
 ],
 "previewOnly": [
  "预览 · 尚未传输",
  "Preview · No transfer started"
 ],
 "capacityDetails": [
  "查看云端用量明细",
  "View storage estimates"
 ],
 "skippedScope": [
  "本次跳过",
  "Skipped for this action"
 ],
 "confirmBoth": [
  "确认同步并导入到",
  "Confirm sync and import to"
 ],
 "confirmImport": [
  "确认导入到",
  "Confirm import to"
 ],
 "confirmUploadCount": [
  "确认上传",
  "Confirm upload of"
 ],
 "editScope": [
  "调整本次选项",
  "Change options"
 ],
 "resolvePreview": [
  "请按清单中标出的原因处理：勾选可省略的图片、重新指定文件，或回到上一步调整范围。",
  "Review the indicated items. Accept eligible omissions, locate a file, or change the selection."
 ],
 "nothingEligible": [
  "此选择没有可执行项。请检查使用中、版本分歧及跳过的对话。",
  "No eligible transfers. Review busy, conflicting or skipped chats."
 ],
 "findParent": [
  "先在来源设备补齐必要的对话，再刷新预览。缺少的标识",
  "Restore the required chats on the source and refresh. Missing IDs"
 ],
 "replacementFile": [
  "此次选用的图片",
  "Replacement for this plan"
 ],
 "systemDetail": [
  "系统返回",
  "System response"
 ],
 "locateImage": [
  "重新指定图片…",
  "Locate another image…"
 ],
 "replacement_invalid": [
  "所选文件不是可安全读取的支持图片。请选择普通 PNG、JPEG、GIF 或 WebP 图片。",
  "Choose a readable regular PNG, JPEG, GIF or WebP image."
 ],
 "attachment_image_denied": [
  "系统拒绝读取这张临时截图。可重新指定图片，或接受省略它。",
  "Access to this temporary screenshot was denied. Locate a copy or accept its omission."
 ],
 "attachment_unreadable_image": [
  "系统拒绝读取截图",
  "Screenshot access denied"
 ],
 "spaceJoined": [
  "已加入同步空间",
  "Connected to your sync space"
 ],
 "onlyThisSession": [
  "本次可以同步，下次打开时需要重新填写凭据。",
  "You can sync now. Credentials will be needed when you reopen the app."
 ],
 "signInAgain": [
  "重新填写凭据以恢复连接",
  "Enter credentials to reconnect"
 ],
 "connectionNeedsCredentials": [
  "尚未恢复上次连接",
  "Previous connection needs attention"
 ],
 "credential_test_memory": [
  "隔离测试使用临时凭据。",
  "The isolated test uses temporary credentials."
 ],
 "credential_service_unavailable": [
  "系统未完成安全保存。检查桌面密钥环后可重新保存。",
  "Secure storage did not complete. Check your desktop keyring and try saving again."
 ],
 "credential_write_failed": [
  "无法写入本机连接文件。请检查应用数据目录权限和磁盘空间，然后重新保存。",
  "Could not write the connection file. Check app data permissions and disk space, then save again."
 ],
 "credential_restore_failed": [
  "上次保存的凭据无法读取。解锁系统密钥环后重开应用，或使用恢复文件重新连接。",
  "Saved credentials could not be read. Unlock the keyring and reopen the app, or reconnect using your recovery file."
 ],
 "checkStorage": [
  "检查凭据存储",
  "Check credential storage"
 ],
 "saveCredentialsAgain": [
  "重新保存凭据",
  "Save credentials again"
 ],
 "credentialsRemembered": [
  "已安全保存，下次打开可自动连接。",
  "Saved securely. The connection can be restored next time."
 ],
 "viewCloud": [
  "查看云端对话",
  "View cloud chats"
 ],
 "storageCheckResult": [
  "凭据存储检查结果",
  "Credential storage result"
 ],
 "serviceReachable": [
  "系统凭据服务可访问。请解锁钱包或登录密钥环，然后重新保存。",
  "Secret Service is reachable. Unlock your wallet or login keyring, then save again."
 ],
 "serviceUnconfirmed": [
  "当前桌面会话未能确认 Secret Service 可用。",
  "Secret Service availability could not be confirmed in this desktop session."
 ],
 "unlockSystemStore": [
  "解锁系统钥匙串后重新保存。",
  "Unlock the system keychain and save again."
 ],
 "kwalletHelp": [
  "在 KDE 系统设置中打开钱包并解锁，再点重新保存。",
  "Open and unlock your wallet in KDE settings, then save again."
 ],
 "secretServiceHelp": [
  "在图形桌面会话中启用并解锁登录密钥环，再点重新保存。",
  "Enable and unlock the login keyring in your graphical session, then save again."
 ],
 "archSteps": [
  "Arch Linux 检查步骤",
  "Arch Linux troubleshooting"
 ],
 "archGuide": [
  "在当前用户的桌面终端检查服务。若缺少服务且希望使用 GNOME 密钥环，安装后重新登录桌面并解锁。",
  "Check the service in your desktop terminal. If missing and you want GNOME Keyring, install it, sign in to the desktop again and unlock it."
 ],
 "openingNative": [
  "正在打开原生应用…",
  "Opening native app…"
 ],
 "launchRequested": [
  "已发送打开请求，请在原生应用中核对对话。",
  "Open request sent. Check the chat in the native app."
 ],
 "no_protocol_handler": [
  "未找到该应用的链接处理程序。请打开原生应用，在所选项目中按标题查找此对话。",
  "No registered link handler. Open the app and look for this title in the selected project."
 ],
 "connectThenReturn": [
  "请先加入同步空间，连接成功后继续本次操作。",
  "Join your sync space to continue this action."
 ],
 "removeOnlyLocal": [
  "仅移入回收站的本机对话数",
  "Local chats to move to trash"
 ],
 "checkingRemoval": [
  "正在检查删除范围与共用附件…",
  "Checking removal scope and shared attachments…"
 ],
 "savedShort": [
  "已保存",
  "Saved"
 ],
 "refreshDone": [
  "刷新完成",
  "Refresh complete"
 ],
 "refreshing": [
  "正在刷新本机和云端…",
  "Refreshing local and cloud chats…"
 ],
 "bucketTestOk": [
  "Bucket 读写测试成功。点击连接按钮以加入或创建空间。",
  "Bucket access test passed. Use Connect to join or create the space."
 ],
 "pathsApplied": [
  "已保存所选路径",
  "Selected paths saved"
 ],
 "movingToTrash": [
  "正在备份并移入本机回收站…",
  "Backing up and moving to local trash…"
 ],
 "taskRestoring": [
  "正在恢复并核对本机历史…",
  "Restoring and checking local history…"
 ],
 "chooseMatchingApp": [
  "选择匹配的应用",
  "Select matching app"
 ],
 "selectChatHint": [
  "点对话标题即可上传、导入或继续；勾选可批量操作。",
  "Select a title to upload, import or continue. Check boxes for batch actions."
 ],
 "refreshEmpty": [
  "清除筛选",
  "Clear filters"
 ],
 "assignmentVerified": [
  "已验证原生项目归属",
  "Native project assignment verified"
 ],
 "waitingForApp": [
  "请在原生应用中查看",
  "Check in the native app"
 ],
 "entrySetup": [
  "配置应用",
  "Configure app"
 ]
};
for(const [key,[chinese,english]] of Object.entries(workflowLabels)){zh[key]=chinese;en[key]=english;}

const actionLabels:Record<string,[string,string]>={
 "desktop": [
  "GPT 桌面端",
  "GPT desktop"
 ],
 "editPaths": [
  "更改路径",
  "Edit paths"
 ],
 "userHandoff": [
  "换机与文件夹的说明由你在原生对话中提供。",
  "Describe your new device and folders yourself in the native chat."
 ],
 "replacementUndo": [
  "撤销替换",
  "Undo replacement"
 ],
 "projectLabelVerified": [
  "已验证原生项目归属",
  "Project assignment verified"
 ],
 "progressDetails": [
  "任务详情",
  "Task details"
 ],
 "restartDetection": [
  "重新检测",
  "Detect again"
 ],
 "returnManual": [
  "返回配置",
  "Back to setup"
 ],
 "destinationAmbiguous": [
  "同一历史目录选了不同的原生项目。请统一项目或分开导入。",
  "Select one project per shared history folder or import separately."
 ],
 "restoreActive": [
  "正在恢复并核对历史…",
  "Restoring and checking history…"
 ],
 "restoredLocal": [
  "本机历史已恢复，请重新打开 Codex 检查对话。",
  "Local history restored. Reopen Codex to check your chats."
 ],
 "joiningSpace": [
  "正在连接同步空间…",
  "Connecting to your sync space…"
 ],
 "credential_reset": [
  "已断开。使用已有空间的恢复文件可以重新连接。",
  "Disconnected. Reconnect using your existing recovery file."
 ],
 "readingVersions": [
  "正在比较云端分支…",
  "Comparing cloud branches…"
 ],
 "chooseVersion": [
  "使用这个版本…",
  "Use this version…"
 ],
 "refreshEmpty": [
  "清除筛选",
  "Clear filters"
 ],
 "cloudEmptyHint": [
  "当前筛选下没有云端对话。可清除筛选；若仍为空，核对两端的空间 ID 并刷新。",
  "No cloud chats match this view. Clear filters. If empty, compare space IDs on both devices and refresh."
 ],
 "reviewSelectedTitles": ["查看所选对话", "Review selected chats"],
 "outsideFilters": ["当前筛选之外", "Outside current filters"],
 "launchManualHint": [
  "导入后请手动打开原生应用，按项目或标题查找。",
  "After import, open the native app and find the project or title."
 ]
};
for(const [key,[chinese,english]] of Object.entries(actionLabels)){zh[key]=chinese;en[key]=english;}

zh.noChangesToApply='没有选中需要修改的配置。现有配置可继续使用。';en.noChangesToApply='No changes selected. Existing settings remain available.';
zh.fillConnectionFields='先填写 Bucket、S3 地址和一对 R2 访问凭据。加入已有空间时，同时载入恢复文件。';en.fillConnectionFields='Enter the bucket, S3 endpoint and both R2 credentials. Load your recovery file when joining an existing space.';
zh.launchManualHint='此入口可能需要手动打开应用，再按项目或标题查找。';en.launchManualHint='This app may need to be opened manually. Find the chat by project or title.';

zh.languageSaved='已保存界面语言';en.languageSaved='Language saved';
zh.refreshAndRetry='刷新并重试';en.refreshAndRetry='Refresh and retry';
zh.preservingVersion='正在云端保留本机版本…';en.preservingVersion='Preserving the local version in the cloud…';
zh.alreadyBackedUp='云端已有相同版本';en.alreadyBackedUp='Already backed up';
zh.workspace_create_failed='文档目录不可写，未创建工作目录。请用「选择文件夹」选择可写目录。';en.workspace_create_failed='The workspace could not be created in Documents. Choose a writable folder.';

zh.local_permission_denied='系统拒绝访问所选位置。请检查该文件或目录的权限，再重新检查。';en.local_permission_denied='Access to the selected location was denied. Check its permissions, then try again.';
zh.read_only_disk='目标位置是只读的。请选择可写位置后重试。';en.read_only_disk='The destination is read-only. Choose a writable location and retry.';
zh.local_path_missing='所选文件或目录已不存在。请重新选择可用位置。';en.local_path_missing='The selected file or folder no longer exists. Choose an available location.';
zh.local_in_use='目标正在被使用。请退出占用该历史的应用，再重新检查。';en.local_in_use='The destination is in use. Close the app using that history and check again.';

const removalLabels:Record<string,[string,string]>={
  closeBeforeLocal: ["确认前请保存工作并退出使用这份历史的 Codex。需要写入本机历史时，程序会先检查占用。","Save your work and quit Codex apps using this history before confirming. The app checks for open writers before changing local history."],
  sideLocalCleanup: ["仅剩本机回收副本待清理，可重试。","Only local recycle-bin cleanup remains. You can retry."],
  sideCleanup: ["清单已登记，云端操作待收尾","Review recorded. Cloud operation needs to finish."],
  assetDecision_recycledShared: ["此版本移入回收站。其他版本的附件保留。","This version is recycled. Other versions retain the attachment."],
  trash_uncertain: ["有历史无法完整核对附件归属，保留在原位置","Ownership could not be verified for all history. File retained."],
  chatCountUnit: ["条对话","chats"],
  binStorageFolder: ["本次处理的回收副本目录","Recycled copy being processed"],
  nativeHistoryLocation: ["对应的原生历史目录","Original app history folder"],
  originalLocation: ["原位置","Original location"],
  chooseVersionsHint: ["默认勾选全部版本。想保留某一版时取消它的勾选，再点「更新清单」核对剩余版本。","All versions are initially selected. Untick versions to leave alone, then update the review to see what will remain."],
  indexOnlyRemoval: ["仅处理仍在本机的原生记录。索引指向的历史文件当前不存在。","Only existing native records are included. The indexed history file is absent."],
  removeChats: ["删除对话","Delete chats"],
  reviewRemoval: ["确认处理清单","Review affected copies"],
  manageBinCopy: ["处理回收站副本","Manage a recycled copy"],
  deleteWhere: ["删除哪里？","Where should the chats be removed?"],
  deleteHow: ["怎么处理？","What should happen to those copies?"],
  removeHere: ["仅本机","This device only"],
  removeCloud: ["仅云端","Cloud only"],
  removeBoth: ["本机和云端","This device and cloud"],
  toBin: ["移入回收站","Move to recycle bin"],
  permanentDelete: ["彻底删除","Delete permanently"],
  restoreCopy: ["恢复副本","Restore copy"],
  thisDevice: ["本机","This device"],
  currentSpace: ["当前 R2 同步空间","Current R2 space"],
  backupVersions: ["个备份版本","backup versions"],
  bothCopies: ["本机及云端均有副本","Present here and in the cloud"],
  otherDevices: ["其他电脑","Other devices"],
  otherNoChange: ["云端备份和其他电脑上已导入的对话都会保留。","Cloud backups and chats already imported on other devices stay available."],
  otherCloudImpact: ["已经导入的对话仍可继续。所有设备共享此空间的可下载版本，移除最后一个版本后须先恢复或重新上传才能下载。","Chats already imported remain usable. All devices share the available cloud versions. Removing the last one makes downloading unavailable until a copy is restored or uploaded again."],
  otherBinImpact: ["只处理清单中的回收站副本。其他电脑上已经导入的对话仍可继续。","Only the listed recycled copies are affected. Chats already imported on other devices remain usable."],
  remoteRestoreHint: ["恢复后同一空间的设备可以下载，需要时各自在本机确认导入。","Devices in this space can download the restored versions. Each device chooses whether to import them."],
  binPolicy: ["可在「备份与恢复」找回。本机和云端各自保留恢复副本，仍占用空间。","Recover these copies in Backups & recovery. Each selected location retains the data and storage usage."],
  permanentPolicy: ["会清理所选位置的指定副本。已有安全备份、共用文件及其他保留项会在下一步列明。","The listed copies will be permanently removed from the chosen location. Review existing safety backups and shared files in the next step."],
  deleteOffline: ["当前未连接云端。可以处理本机历史，连接同步空间后可选择云端。","Cloud storage is disconnected. Local history is available here. Connect the space to manage cloud copies."],
  cloudOnlyRemoval: ["当前只找到可操作的云端版本。回收站和其他已知备份在清单里单列。","Only cloud versions are active. Recycled and other known copies are shown separately in the review."],
  localOnlyRemoval: ["当前只找到可操作的本机历史。回收站和其他已知备份在清单里单列。","Only device history is active. Recycled and other known copies are shown separately in the review."],
  onlyBinCopy: ["只处理这份回收记录。已经恢复或后来新建的本机对话会保留。","This action applies to the recycled copy. Restored or newly created local chats remain available."],
  removalPreviewOnly: ["正在预览，尚未执行本次操作","Preview only. This action has not started."],
  outsideRemoval: ["此位置没有副本，跳过","No copy at this location. Skipped."],
  sharingEntries: ["下列入口共用这份历史","Apps using this history"],
  listedFilesSize: ["清单文件大小","Listed file size"],
  binUsesSpace: ["回收站保留数据，本次不释放这些文件空间。","Recycling retains the data and its storage usage."],
  fileBytesHint: ["数据库共用页和另存的恢复副本会保留。实际可用磁盘空间由系统决定。","Shared database pages and separately retained backups remain. The operating system determines available disk space."],
  includeAndReview: ["加入所列依赖并更新本机清单","Include listed dependents and review again"],
  cloudFreeEstimate: ["预计释放的云端对象空间","Estimated cloud object storage released"],
  currentVersion: ["当前可导入","Currently available"],
  availableAfter: ["完成后可导入","Available to import afterward"],
  noActiveVersion: ["没有可下载的版本","No downloadable versions"],
  branchesRemain: ["保留多个分支，可比较后选择。","Several branches remain. Compare before choosing."],
  keptCopies: ["会保留的其他副本","Other copies that will remain"],
  noKnownCopies: ["本次检查未发现额外副本。其他设备或手工导出的文件不在检查范围内。","No additional copy was found in this check. Other devices and manually exported files are outside its scope."],
  wholeBackup: ["本机整库安全备份","Full local safety backup"],
  wholeBackupHint: ["保留整个目录备份，其中可能含此对话及其他对话。","This directory backup is retained and may contain this chat and other chats."],
  cloudBin: ["云端回收站","Cloud recycle bin"],
  localBin: ["本机回收站","Device recycle bin"],
  cloudActive: ["可用的云端备份","Available cloud backup"],
  unlistedVersion: ["仍在空间中的独立版本","Unlisted version retained in this space"],
  localCopiesRetained: ["本机已导入的对话、附件和项目文件保留。","Chats imported on this device, their attachments and project files are retained."],
  uninspectedCloud: ["云端未连接或未能完成检查。云端副本不在本次删除范围内。","Cloud copies could not be checked and are outside this local action."],
  assetDecision_absent: ["备份中没有这份附件","Attachment absent from backup"],
  assetDecision_kept: ["此版本保留","Version retained"],
  assetDecision_recycled: ["随版本移入云端回收站","Recycled with this version"],
  assetDecision_restored: ["随版本恢复","Restored with this version"],
  assetDecision_shared: ["其他版本仍使用此附件，保留","Retained because another version uses this attachment"],
  assetDecision_partlyShared: ["仅清理独占部分，共用数据保留","Only unshared data is removed. Shared data is retained."],
  assetDecision_removed: ["清理本次选中的副本","Remove the selected copy"],
  upgradeSpaceConsent: ["首次使用云端删除会升级此空间。已停止旧版传输，并将访问此空间的 Sesshuttle 更新至 0.3.0 或更高版本。","The first cloud removal upgrades this space. I have stopped older transfers and updated devices accessing this space to Sesshuttle 0.3.0 or later."],
  permanentConsent: ["我已核对位置、版本和保留项，确认彻底删除所列副本。","I have checked the locations, versions and retained copies, and approve permanent deletion of the listed copies."],
  versionSelectionChanged: ["版本选择已改变。请更新清单，再核对释放空间和剩余版本。","The version selection changed. Update the list to review storage and remaining versions."],
  showRemovalList: ["查看处理清单","Review affected copies"],
  changeDeleteOptions: ["返回修改选项","Change options"],
  recomputeRemoval: ["更新清单","Update review"],
  readingRemoval: ["正在核对历史、附件、版本及其共用关系…","Checking history, attachments, versions and shared data…"],
  removingNow: ["正在执行已确认的操作…","Applying your confirmed action…"],
  sideDone: ["已完成","Completed"],
  sideFailed: ["需要处理","Needs attention"],
  sideWaiting: ["尚未执行","Not started"],
  sideRunning: ["处理中","Working"],
  reviewRemaining: ["查看并重试未完成部分","Review and retry unfinished work"],
  retryOnlyRemaining: ["只会重试未完成的部分。已完成的位置会跳过。","Only unfinished locations will be retried. Completed work is skipped."],
  reviewChangedRemoval: ["按最新状态重新预览","Review the latest state"],
  removePartial: ["部分完成，请查看各位置结果","Partially completed. Check each location below."],
  removeAttention: ["操作未完成，请查看原因","Action incomplete. Check the reason below."],
  removeComplete: ["操作已完成","Action complete"],
  removeInterrupted: ["上次操作中断，等待核对","Interrupted. Review before continuing."],
  replacedReview: ["已使用新清单继续处理","Replaced by a new review"],
  cloudObjects: ["个云端对象","cloud objects"],
  cloud_removed: ["云端备份已移除，本机仍保留","Cloud backup removed. Local chat retained."],
  localBinHint: ["本机回收站仅在这台电脑可用。选中一份记录可恢复或彻底删除。","This bin is available on this device. Choose a record to restore or permanently remove."],
  cloudBinHint: ["加入同一空间的设备均可恢复这里的版本。恢复后可重新下载。","Devices in this space can restore these versions and download them again."],
  noBinItems: ["回收站目前为空。","The recycle bin is empty."],
  loadingBins: ["正在读取本机和云端回收站…","Reading the device and cloud recycle bins…"],
  removalActivity: ["删除与恢复记录","Deletion and recovery activity"],
  closeAfterRemoval: ["正在完成已确认的删除或恢复。请等待各位置结果再关闭窗口。","A confirmed removal or recovery is in progress. Wait for the location results before closing."],
  nothing_to_remove: ["这个范围没有可处理的副本。请调整位置或选择版本。","There are no eligible copies in this scope. Change the location or select versions."],
  space_changed: ["当前连接的同步空间已改变。请连接原空间或重新选择对话预览。","The connected sync space changed. Reconnect the original space or start a new review."],
  permanent_confirmation: ["请先核对清单并勾选永久删除确认。","Review the list and acknowledge permanent deletion first."],
  cloud_upgrade_required: ["请先确认使用此空间的客户端已升级，再执行云端操作。","Confirm that clients using this space are updated before applying the cloud change."],
  cloud_writer_busy: ["此空间有写入任务。请等任务完成后重试。若发起设备意外退出，请在那台设备重新打开并重试。","This space has a writer. Wait for it to finish. If it was interrupted, reopen Sesshuttle on the initiating device and retry."],
  cloud_cleanup_pending: ["云端上次已确认的操作尚未收尾。到「备份与恢复 → 云端回收站」继续该操作，再进行新写入。","A previously confirmed cloud change is unfinished. Resume it in Backups & recovery → Cloud recycle bin before making new changes."],
  finishConfirmedCloud: ["完成上次已确认的云端操作","Finish previously confirmed cloud work"],
  finishPendingHint: ["按上次已确认的云端清单收尾。只处理原清单中的云端对象，其他设备的本机历史保留。继续？","Finish the previously confirmed cloud list. Only objects in that list will be processed. Copies on devices remain in place. Continue?"],
  cloudFinishDone: ["上次已确认的云端操作已完成。","The previously confirmed cloud operation is complete."],
  resume_original_plan: ["已有一部分正在收尾。请返回原清单重试，或从回收站完成上次操作。","Work from the original review is still pending. Retry that review or finish it from the recycle bin."],
  trashStatus_purging: ["永久清理待完成","Permanent cleanup pending"],
  trashStatus_staging: ["正在准备安全副本","Preparing safety copy"],
  configureRemovalStorage: ["配置云端存储","Configure cloud storage"]
};
for(const [key,[chinese,english]] of Object.entries(removalLabels)){zh[key]=chinese;en[key]=english;}

const connectionLabels:Record<string,[string,string]>={
 "rememberDevice": [
  "在这台电脑记住连接",
  "Remember this connection on this computer"
 ],
 "replaceRecovery": [
  "选择另一份恢复文件",
  "Choose a different recovery file"
 ],
 "importConnectionFile": [
  "从另一台电脑导入连接文件…",
  "Import a connection file from another computer…"
 ],
 "fileFieldsReady": [
  "文件已载入，连接信息已填好。输入 R2 Secret Access Key 即可连接。",
  "File loaded. Your connection details are filled in. Enter the R2 Secret Access Key to connect."
 ],
 "legacyIdMissing": [
  "旧文件未包含 Access Key ID。可在已连接的电脑上用新版重新导出，或在下方填写 ID。",
  "This older file has no Access Key ID. Export it again with the new version on the connected computer, or enter the ID below."
 ],
 "manualConnection": [
  "改为手动输入连接信息",
  "Enter connection details manually"
 ],
 "stillNeeded": [
  "连接还需要填写",
  "Still needed to connect"
 ],
 "invalid_recovery_file": [
  "无法读取此连接文件。请选择从 Sesshuttle 导出的恢复 JSON。",
  "Cannot read this connection file. Choose a recovery JSON exported by Sesshuttle."
 ],
 "export_id_missing": [
  "当前连接没有可导出的 Access Key ID。先解锁已保存的连接，或重新填写凭据，再导出。",
  "This connection has no Access Key ID to export. Unlock the saved connection or enter its credentials, then export again."
 ],
 "recovery_target_changed": [
  "连接地址与恢复文件不匹配。请选择对应空间的文件，或改用手动输入。",
  "The destination does not match the recovery file. Choose the file for this space or enter the connection manually."
 ],
 "keyHint": [
  "恢复文件含同步空间的解密密钥和 Access Key ID，请妥善保管。新电脑导入后只需补填 R2 Secret Access Key。",
  "Keep the recovery file safe. It contains the space decryption key and Access Key ID. On the new computer, import it and enter the R2 Secret Access Key."
 ],
 "credential_session_only": [
  "你选择了仅本次使用。退出后需重新填写连接凭据。",
  "You chose to use this connection for this session. Enter credentials again after quitting."
 ]
};
for(const [key,[cn,us]] of Object.entries(connectionLabels)){zh[key]=cn;en[key]=us;}

const authorizationLabels:Record<string,[string,string]>={
 "waitingAuthorization": [
  "正在访问系统密码库。若系统弹出授权窗口，请在那里确认或取消。",
  "Accessing the system password store. If a system dialog opens, allow or cancel there."
 ],
 "systemStoreHint": [
  "点「记住连接」或「解锁并连接」，按 macOS 系统提示操作。",
  "Choose Remember connection or Unlock and connect and follow the macOS dialog."
 ],
 "manageConnection": [
  "管理连接",
  "Manage connection"
 ],
 "openConnection": [
  "打开连接设置",
  "Open connection settings"
 ],
 "rememberAndAuthorize": [
  "记住连接…",
  "Remember connection…"
 ],
 "authorizeAndConnect": [
  "解锁并连接…",
  "Unlock and connect…"
 ],
 "savedConnectionLocked": [
  "已保存的连接尚未恢复。",
  "The saved connection has not been restored."
 ],
 "reconnectAfterSession": [
  "上次仅在本次运行中使用。重新导入连接文件或填写下方信息。",
  "The previous connection was session-only. Import your connection file or fill in the fields below."
 ],
 "credential_cancelled": [
  "已取消系统授权。准备好时可以再次授权。",
  "System authorization was cancelled. You can try again when ready."
 ],
 "credential_authorization_failed": [
  "系统未授权访问密码库。请重试并在系统窗口中确认。",
  "The system did not grant access. Try again and allow access in the system dialog."
 ],
 "credential_item_missing": [
  "系统密码库里找不到这份连接。请导入恢复文件并重新连接。",
  "The saved credentials could not be found. Import the recovery file and reconnect."
 ],
 "credential_provider_failed": [
  "密码库回应了请求，但未完成读写。请重新授权；仍失败时可仅本次连接。",
  "The password store responded but could not complete the request. Retry authorization or connect for this session."
 ],
 "credential_service_timeout": [
  "系统密码库没有响应。请重新检查服务，再试一次。",
  "The system password store did not respond. Check the service and retry."
 ],
 "credential_locked": [
  "密码库仍锁定。点击重新授权，在系统窗口中确认。",
  "The password store is still locked. Request authorization again and respond in the system dialog."
 ],
 "credential_service_unavailable": [
  "当前用户会话没有可访问的系统密码库。可查看设置步骤，或继续仅本次使用。",
  "No system password store is reachable in this user session. See setup steps or use this session only."
 ],
 "systemLocked": [
  "系统密码库已锁定。使用上方按钮可请求系统打开解锁窗口。",
  "The password store is locked. Use the authorization button above to request the system dialog."
 ],
 "systemReachable": [
  "系统密码库可访问。使用上方按钮重试。",
  "The system password store is reachable. Use the button above to retry."
 ],
 "linuxSetupHelp": [
  "如何在当前 Linux 会话启用密码库",
  "Enable a password store for this Linux session"
 ],
 "serviceSetup": [
  "请在当前图形会话中启用支持 Secret Service 的密码库，例如 GNOME Keyring、KWallet 或已启用此功能的 KeePassXC。已有密码库时优先使用它。",
  "Enable a Secret Service provider for this graphical login, such as GNOME Keyring, KWallet, or KeePassXC with Secret Service enabled. Prefer your existing provider."
 ],
 "archExample": [
  "Arch 示例（本机尚未安装密码库时）",
  "Arch example if no password store is installed"
 ],
 "afterServiceSetup": [
  "设置好后点「检查凭据存储」，再点「记住连接」。本次已连接的空间可继续使用。",
  "After setup, check credential storage and choose Remember connection. A space already connected in this session stays usable."
 ],
 "credentialsRemembered": [
  "连接已安全保存在这台电脑，下次启动会尝试自动连接。",
  "Connection saved securely on this computer. Sesshuttle will reconnect on startup."
 ]
};
for(const [key,[cn,us]] of Object.entries(authorizationLabels)){zh[key]=cn;en[key]=us;}

const reviewLabels:Record<string,[string,string]>={
 "excluded": [
  "未执行",
  "Not run"
 ],
 "batchEligibility": [
  "本次可处理 {ready} 个，以下 {blocked} 个将跳过。",
  "{ready} eligible. The following {blocked} will be left out."
 ],
 "onlyUploadEligible": [
  "仅上传可用的 {n} 个对话",
  "Upload only the {n} eligible conversations"
 ],
 "onlyImportEligible": [
  "仅导入可用的 {n} 个对话",
  "Import only the {n} eligible conversations"
 ],
 "onlySyncEligible": [
  "仅同步可用的 {n} 个对话",
  "Sync only the {n} eligible conversations"
 ],
 "partial_scope_confirmation": [
  "部分对话无法执行。请先核对可用条目，再确认只处理这些对话。",
  "Some conversations cannot proceed. Review the eligible list and confirm that subset."
 ],
 "noLocalForUpload": [
  "这台电脑没有该对话可上传的本机副本。",
  "There is no local copy on this device to upload."
 ],
 "noBackupToImport": [
  "当前空间没有该对话可导入的备份。",
  "There is no backup of this conversation in the current space to import."
 ],
 "acceptConversationImages": [
  "接受此对话缺少这 {n} 张图片并继续",
  "Continue without these {n} images in this conversation"
 ],
 "confirmImagesFor": [
  "请为下列对话选择补上图片或接受缺图，再确认。",
  "Locate the images or accept their omission for these conversations before continuing."
 ],
 "nothingEligible": [
  "本次没有可执行的对话。请查看上方每个标题旁的原因，调整选择后重新预览。",
  "No conversations can proceed. Review the reason beside each title above, adjust the selection and preview again."
 ],
 "cloudRemovalHistory": [
  "这份云端备份已移除。若要重新备份，请选择「上传到云端」。",
  "This backup was removed from the cloud. Choose Upload to cloud to back it up again."
 ],
 "incomplete": [
  "只备份现有数据库记录（缺少续聊所需的历史文件）",
  "Back up available database records only when the history file for continuing is missing"
 ],
 "historyReceived": [
  "历史已下载",
  "History downloaded"
 ],
 "cacheRetryHint": [
  "本次运行中已下载的内容可用于重试。",
  "Downloaded data can be reused for retries in this session."
 ],
 "entryReady": [
  "已导入，可以继续",
  "Imported and ready to continue"
 ],
 "entryUnverified": [
  "历史已写入，续聊尚未验证",
  "History written, continuation not verified"
 ],
 "entry_binary_missing": [
  "还缺 Codex 可执行文件。点击检测或选择该应用使用的 Codex 程序。",
  "The Codex executable is missing. Detect it or choose the Codex program used by this app."
 ],
 "entry_home_missing": [
  "还缺保存对话历史的文件夹。点击检测，或选择本机的 Codex 数据目录。",
  "Choose the folder that stores this app’s Codex history, or detect it here."
 ],
 "kernelProgram": [
  "Codex 可执行文件",
  "Codex executable"
 ],
 "kernelMeaning": [
  "用于检查和打开导入的历史。例如 Codex 命令行程序。桌面启动器与它是两个文件。",
  "The Codex program used to verify imported history. The desktop launcher is a separate file."
 ],
 "historyMeaning": [
  "此入口保存 Codex 对话的目录，通常含 sessions 或 state 数据库。",
  "The folder where this app stores Codex conversations, usually containing sessions or a state database."
 ],
 "project_assignment_unsupported": [
  "此版本无法验证桌面项目归属。可选择「仅导入历史」，自行在应用内打开。",
  "This version cannot verify the desktop project. Choose history only and open it in the app."
 ],
 "project_assignment_failed": [
  "未能确认对话已归入所选项目。到「备份与恢复」查看本次导入，再决定是否恢复。",
  "Project placement could not be verified. Review this import in Backups & recovery before restoring."
 ],
 "saveAndReturn": [
  "保存所选路径并继续导入",
  "Save selected paths and continue import"
 ],
 "detectedLauncher": [
  "已找到桌面启动器。仍需确认该应用使用的 Codex 程序和历史目录。",
  "Desktop launcher found. Its Codex executable and history folder must still be verified."
 ],
 "detectedApplied": [
  "所选路径已保存。请继续选择本机项目。",
  "Selected paths saved. Continue by choosing a project on this computer."
 ],
 "chooseVersionsHint": [
  "默认选中全部版本。取消勾选要保留的版本，清单将自动更新。",
  "All versions are selected initially. Untick versions you want to keep. The list updates automatically."
 ],
 "versionSelectionChanged": [
  "版本选择已改变。更新清单后才能确认删除。",
  "The version selection changed. Confirmation is available after the list updates."
 ],
 "reviewConsentHint": [
  "请先勾选上方确认项，才能执行所列操作。",
  "Check the acknowledgement above before proceeding."
 ],
 "busyReason": [
  "Codex 正在写入此对话。请等写入结束，再刷新预览。",
  "Codex is writing to this conversation. Wait for it to finish, then refresh the preview."
 ],
 "emptyFiltered": [
  "当前筛选没有匹配的对话。可清除筛选查看其他记录。",
  "No conversations match these filters. Clear the filters to see other records."
 ]
};
for(const [key,[cn,us]] of Object.entries(reviewLabels)){zh[key]=cn;en[key]=us;}

const savingConnectionLabels:Record<string,[string,string]>={
 "credential_save_pending": [
  "同步空间已连接。请在系统密码库的授权窗口中完成保存。",
  "Your sync space is connected. Complete the system password-store prompt to remember this connection."
 ]
};
for(const [key,[cn,us]] of Object.entries(savingConnectionLabels)){zh[key]=cn;en[key]=us;}
