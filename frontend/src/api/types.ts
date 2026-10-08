// API 通用类型定义

// 统一响应结构
export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
  /** 链路追踪 ID (与响应头 X-Trace-Id 一致), 用于日志关联 */
  trace_id?: string
  /** 服务端响应时间戳 (ms) */
  timestamp?: number
}

// 分页请求参数
export interface PageParams {
  page?: number
  size?: number
  keyword?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// 分页响应数据
export interface PageVO<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// ============ 素材管理 ============

export type AssetType = 'image' | 'video' | 'audio' | 'prompt' | 'template' | 'lut' | 'font'
export type AssetOrigin = 'upload' | 'ai_generated' | 'url_import' | 'extracted_frame' | 'forked'
export type AssetLicense = 'self' | 'commercial' | 'personal' | 'ai_generated'
export type AssetStatus = 1 | 0 | -1  // 1 正常 / 0 隐藏 / -1 回收站

export interface TagVO {
  id: number
  name: string
  category: string
  sortOrder: number
  usageCount?: number
  /** 是否 AI 自动打标签 (B 模式素材特有) */
  isAuto?: boolean
}

export interface AssetVO {
  id: string
  type: AssetType
  name: string
  description?: string
  url: string
  thumbnailUrl?: string
  md5: string
  sizeBytes: number
  mimeType: string
  width?: number
  height?: number
  durationMs?: number
  origin: AssetOrigin
  license?: AssetLicense
  status: AssetStatus
  folderId?: string | null
  tags: TagVO[]
  usageCount: number
  createdAt: string
  lastUsedAt?: string
}

export interface AssetFolderVO {
  id: string
  parentId?: string | null
  name: string
  icon?: string
  sortOrder: number
  assetCount: number
  children: AssetFolderVO[]
  createdAt: string
}

export interface AssetQueryParams {
  type?: AssetType
  folderId?: string
  recursive?: boolean
  tagIds?: string
  q?: string
  origin?: AssetOrigin
  sort?: 'last_used' | 'created' | 'name' | 'size'
  order?: 'asc' | 'desc'
  page?: number
  size?: number
  includeTrash?: boolean
  scope?: 'mine' | 'all_groups' | 'specific_group'
  groupId?: string
}

export interface AssetUpdateRequest {
  name?: string
  description?: string
  folderId?: string | null
  status?: AssetStatus
  license?: AssetLicense
}

export interface AssetBatchRequest {
  ids: string[]
  folderId?: string | null
}

export interface AssetUrlImportRequest {
  url: string
  type?: AssetType
  name?: string
  folderId?: string
  /** 来源标识: url_import (默认, 重新上传) / ai_generated (作品 OSS 图, 直接引用) */
  origin?: 'url_import' | 'ai_generated'
  /** 源作品 ID (origin=ai_generated 时带上, 用于追溯) */
  sourceWorkId?: string
}

export interface AssetFolderRequest {
  parentId?: string | null
  name: string
  icon?: string
  sortOrder?: number
}

// ============ 组织 ============

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface OrgVO {
  id: string
  parentId?: string | null
  name: string
  brandConfig?: Record<string, unknown>
  status: number
  myRole?: OrgRole
  memberCount?: number
  createdAt: string
}

export interface OrgRequest {
  name: string
  parentId?: string
  brandConfig?: Record<string, unknown>
}


// ============ 作品相关类型 ============

export type WorkType = 'video' | 'image'
export type WorkStatus = 'processing' | 'success' | 'failed' | 'discarded'

// 作品基础信息（灵感广场返回类型）
export interface WorkInfoVO {
  id: string
  type: WorkType
  status: WorkStatus
  thumbnail: string
  url?: string
  prompt: string
  modelId?: string
  modelName: string
  tags: string[]
  cost?: number
  finishedAt?: string
  isShared: boolean
  shareTitle?: string
  shareId?: string
  author?: AuthorVO
  likes?: number
  favorites?: number
  comments?: number
  isLiked?: boolean
  isFavorite?: boolean
  createdAt: string
}

// 作品详情（继承 WorkInfoVO）
export interface WorkDetailVO extends WorkInfoVO {
  aspectRatio: string
  resolution: string
  duration?: number
  referenceMode?: 'frames' | 'subject'
  referenceImageUrls?: string[]
  remark?: string
  externalTaskId?: string
  checkTime?: string
  taskSubmittedAt?: string
  externalResult?: unknown
  checkCount?: number
  errorMessage?: string  // 失败原因
  generationTime?: number  // 生成耗时 (毫秒)
  updatedAt?: string
}

// ==================== 创作模板 (Creation Template) ====================

export type PromptVarType = 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'switch'

export interface PromptVarOption {
  label: string
  value: string | number
}

export interface PromptVar {
  name: string
  label: string
  type: PromptVarType
  required?: boolean
  default?: unknown
  placeholder?: string
  help?: string
  maxLength?: number
  min?: number
  max?: number
  options?: PromptVarOption[]
}

export interface ParamOption {
  default: string | number
  options: PromptVarOption[]
}

export interface ImageParamsConfig {
  aspect_ratio?: ParamOption
  resolution?: ParamOption
}

export interface VideoParamsConfig {
  aspect_ratio?: ParamOption
  duration?: ParamOption
  resolution?: ParamOption
}

export type ReferenceImageMode = 'none' | 'static' | 'user_upload' | 'optional_upload'

export interface ReferenceImageConfig {
  mode: ReferenceImageMode
  staticUrls?: string[]
  maxCount?: number
  label?: string
  help?: string
}

export interface TemplateModelInfo {
  id: string
  code: string
  name: string
  type: 'image' | 'video'
  provider: string
}

export interface TemplateVO {
  id: string
  code: string
  name: string
  description: string
  group: string
  tags: string[]
  coverImageUrl: string
  modelType: 'image' | 'video'
  modelId: string | null
  model?: TemplateModelInfo | null
  promptTemplate: string
  promptVars: PromptVar[]
  imageParamsConfig: ImageParamsConfig | null
  videoParamsConfig: VideoParamsConfig | null
  referenceImageConfig: ReferenceImageConfig
  cost: number | null
  isHot: boolean
  isNew: boolean
  usageCount: number
  sortOrder: number
}

export interface TemplateListVO {
  list: TemplateVO[]
  total: number
  page: number
  pageSize: number
}

export interface TemplateGroupVO {
  group: string
  templateCount: number
}

export interface WorkStatusVO {
  id: string
  status: WorkStatus
  progress?: number
  url?: string
  thumbnail?: string
  errorMessage?: string
}

export interface CreateWorkVO {
  id: string
  status: WorkStatus
  message?: string
}

export interface CreateVideoWorkRequest {
  modelId: string
  prompt: string
  aspectRatio: string
  resolution: string
  duration: number
  referenceMode?: 'frames' | 'subject'
  referenceImageUrls?: string[]
  tags?: string[]
}

export interface CreateImageWorkRequest {
  modelId: string
  prompt: string
  aspectRatio: string
  resolution: string
  referenceMode?: 'subject'
  referenceImageUrls?: string[]
  tags?: string[]
}

export interface UpdateWorkRequest {
  remark?: string
  tags?: string[]
  isFavorite?: boolean
}

export interface WorkListParams extends PageParams {
  type?: WorkType
  status?: WorkStatus
  keyword?: string
  tags?: string
  timeRange?: 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'all' | 'custom'
  startTime?: string  // 自定义时间范围开始日期 (yyyy-MM-dd)
  endTime?: string    // 自定义时间范围结束日期 (yyyy-MM-dd)
  userId?: string     // 按作者筛选
  modelName?: string  // 按模型筛选
  scope?: 'mine' | 'all_groups' | 'specific_group'  // 范围筛选
  groupId?: string    // 指定群组ID（scope=specific_group 时使用）
}

export interface AdminWorkListParams extends PageParams {
  type?: WorkType
  status?: WorkStatus
  keyword?: string
  userId?: string
  modelId?: string
  tags?: string
  timeRange?: 'today' | 'week' | 'month' | '' | 'custom'
  startTime?: string  // 自定义时间范围开始日期 (yyyy-MM-dd)
  endTime?: string    // 自定义时间范围结束日期 (yyyy-MM-dd)
  sortField?: 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

// ============ 用户相关类型 ============

export interface UserVO {
  id: string
  name: string
  avatar: string
  department?: string
  role?: string
  credits: number
  email?: string
  phone?: string
  createdAt?: string
  /** 是否为运维者 (基于 app.ops.user-ids 配置) - 控制运维管理菜单可见性 */
  ops?: boolean
}

export interface UserCreditsVO {
  balance: number
  totalEarned: number
  totalSpent: number
}

export interface UpdateUserRequest {
  name?: string
  avatar?: string
  department?: string
  role?: string
}

// ============ 模型相关类型 ============

export type ModelType = 'video' | 'image'
export type ReferenceMode = 'subject' | 'frames' | 'none'

// 模型配置项成本
export interface ModelCostItem {
  cost: number
  duration: number
  ratio: string
  resolution: string
}

export interface ModelVO {
  id: string
  name: string
  type: ModelType
  cost: number
  /** 价格倍率 100 = 1.00 倍, 默认 150. 用户实付 = cost × priceMultiplier / 100 */
  priceMultiplier?: number
  costList: ModelCostItem[]
  description: string
  isHot?: boolean
  isNew?: boolean
  icon?: string
  status?: ModelStatus  // 1: 启用, 0: 维护中, -1: 已下线
}

export interface ModelDetailVO extends ModelVO {
  supportedRatios: string[]
  supportedResolution: string[]
  supportedDurations: number[]
  supportedReferenceMode: ReferenceMode[]
  supportedReferenceNum: number
  features?: string[]
  usageGuide?: string
  /** 价格倍率 100=1.00倍, 默认 150=1.50倍, 用户实付 = 模型原始算力 × priceMultiplier / 100 */
  priceMultiplier?: number
}

// ============ 社区相关类型 ============

export interface AuthorVO {
  id: string
  name: string
  avatar: string
  department?: string
}

export interface ShareWorkRequest {
  workId: string
  title: string
  description?: string
}

export interface CommentVO {
  id: string
  userId: string
  userName: string
  userAvatar: string
  content: string
  likes: number
  isLiked: boolean
  parentId?: string
  replies?: CommentVO[]
  createdAt: string
}

export interface CreateCommentRequest {
  content: string
  parentId?: string
}

export interface InteractionVO {
  shareId: string
  isLiked: boolean
  isFavorited: boolean
  likes: number
  favorites: number
}

export interface ShareListParams extends PageParams {
  type?: WorkType
  sortBy?: 'latest' | 'popular'
  /** 标签筛选, 逗号分隔的标签名 (后端解析为 id, OR 语义) */
  tags?: string
}

// ============ 算力相关类型 ============

export type TransactionType = 'earn' | 'spend' | 'recharge'

export interface CreditTransactionVO {
  id: string
  type: TransactionType
  amount: number
  balance: number
  description: string
  createdAt: string
}

export interface RechargeRequest {
  amount: number
  packageId?: string
}

export interface RechargePackageVO {
  id: string
  amount: number
  price: number
  bonus: number
  description?: string
}

export interface TransactionListParams extends PageParams {
  type?: TransactionType
}

// ============ 管理员相关类型 ============

export type UserStatus = 0 | 1  // 0: 有效, 1: 禁用

export interface AdminUserVO {
  id: string
  name: string
  email: string
  phone?: string
  avatar: string
  department?: string
  role?: string
  status: UserStatus
  credits: number
  workCount: number
  lastLoginAt?: string
  createdAt: string
}

export interface UpdateUserStatusRequest {
  status: UserStatus
  role?: 'user' | 'vip' | 'admin'
  reason?: string
}

export interface AdminUserListParams extends PageParams {
  status?: UserStatus
  department?: string
  keyword?: string
  role?: string
}

// ============ 管理端模型相关类型 ============

export type ModelStatus = 1 | 0 | -1  // 1: 启用, 0: 维护中, -1: 已下线

export interface AdminModelVO {
  id: string
  modelCode: string
  modelName: string
  modelType: ModelType
  provider?: string
  description?: string
  isHot: boolean
  isNew: boolean
  status: ModelStatus
  statusText: string
  /**
   * 最低算力消耗 (积分), 由列表接口聚合返回, 无需详情接口
   */
  costMin?: number
  /**
   * 最高算力消耗 (积分); 与 costMin 相等时只显示一个值, 否则显示 "min-max"
   */
  costMax?: number
  sortOrder: number
  /**
   * 价格倍率 (整数百分比, 100=1.00倍, 默认 150=1.50倍, 范围 100-1000)
   * 用户实付算力 = 模型原始算力 × (priceMultiplier / 100)
   */
  priceMultiplier?: number
  createdAt: string
  updatedAt?: string
}

export interface VideoExtVO {
  supportedRatios: string[]
  supportedDurations: number[]
  supportedResolution: string[]
  supportedReferenceMode: string[]
  supportedReferenceNum: number
}

export interface ImageExtVO {
  supportedRatios: string[]
  supportedResolution: string[]
  supportedReferenceMode: string[]
  supportedReferenceNum: number
}

export interface ModelCostItemVO {
  /**
   * 画幅比例
   * - "*": 不限
   * - 其他: 具体比例如 "16:9"
   */
  ratio: string
  /**
   * 分辨率
   * - "*": 不限
   * - 其他: 具体分辨率如 "720P"
   */
  resolution: string
  /**
   * 时长（秒）（仅视频模型）
   * - 0: 不限
   * - 正整数: 具体秒数
   */
  duration?: number
  cost: number
}

export interface AdminModelDetailVO extends AdminModelVO {
  apiEndpoint?: string
  /**
   * API 密钥 (后端用 @Sensitive(CUSTOM, "4,4,8") 脱敏, 形如 sk-1********a799)
   * 仅详情接口返回, 编辑时前端用 placeholder 展示
   */
  apiKey?: string
  videoExt?: VideoExtVO
  imageExt?: ImageExtVO
  costList: ModelCostItemVO[]
}

export interface CreateModelRequest {
  modelCode: string
  modelName: string
  modelType: ModelType
  provider?: string
  description?: string
  isHot?: boolean
  isNew?: boolean
  apiEndpoint?: string
  status?: ModelStatus
  sortOrder?: number
  /**
   * 价格倍率 (整数百分比, 默认 150=1.50倍, 范围 100-1000)
   */
  priceMultiplier?: number
}

export interface UpdateModelRequest {
  modelName?: string
  provider?: string
  description?: string
  isHot?: boolean
  isNew?: boolean
  apiEndpoint?: string
  apiKey?: string
  status?: ModelStatus
  sortOrder?: number
  /**
   * 价格倍率 (整数百分比, 默认 150=1.50倍, 范围 100-1000)
   */
  priceMultiplier?: number
}

export interface UpdateModelExtRequest {
  supportedRatios?: string[]
  supportedDurations?: number[]
  supportedResolution?: string[]
  supportedReferenceMode?: string[]
  supportedReferenceNum?: number
}

export interface UpdateModelCostsRequest {
  costs: ModelCostItemVO[]
}

export interface ModelListParams extends PageParams {
  keyword?: string
  type?: ModelType
  status?: ModelStatus
}

// ============ 配置相关类型 ============

export interface VideoConfig {
  aspectRatio: string
  resolution: string
  duration: number
}

export interface ImageConfig {
  aspectRatio: string
  resolution: string
}

// ============ 筛选类型 ============

export type WorkStatusFilter = 'all' | WorkStatus
export type InspirationFilter = 'all' | WorkType | 'popular'

// ============ 上传相关类型 ============

export type UploadType = 'start' | 'end' | 'subject' | 'reference'

export interface UploadFile {
  id: string
  url: string
  name: string
  type: UploadType
}

export interface UploadResponse {
  url: string
  filename: string
  size: number
  mimeType: string
}

// ============ OSS 上传相关类型 ============

export interface OssUploadResponse {
  url: string
  objectKey: string
  fileName: string
  fileSize: number
  contentType: string
}

// ============ 创作群组相关类型 ============

export type GroupRole = 'owner' | 'member'
export type GroupScope = 'mine' | 'all_groups' | 'specific_group'

export interface GroupVO {
  id: string
  name: string
  ownerId: string
  ownerName: string
  myRole: GroupRole
  memberCount: number
  createdAt: string
}

export interface GroupMemberVO {
  userId: string
  name: string
  avatar: string
  role: GroupRole
  joinedAt: string
}

export interface GroupDetailVO {
  id: string
  name: string
  ownerId: string
  ownerName: string
  myRole: GroupRole
  memberCount: number
  createdAt: string
  members: GroupMemberVO[]
}

export interface GroupListVO {
  list: GroupVO[]
  total: number
  page: number
  pageSize: number
  joinedGroupCount: number
  groupCountLimit: number
}

export interface GroupInviteVO {
  groupId: string
  name: string
  ownerName: string
  memberCount: number
  members: GroupMemberVO[]
  shareTip: string
  isJoined: boolean
}

export interface InviteQrcodeVO {
  inviteCode: string
  inviteUrl: string
  qrcodeUrl: string
  expiresAt: string
}

export interface GroupOptionVO {
  list: { id: string; name: string }[]
  joinedGroupCount: number
  groupCountLimit: number
}

export interface CreateGroupRequest {
  name: string
}

export interface GroupListParams extends PageParams {
  type?: 'created' | 'joined'
}

// ============ 智能画布 (Canvas) 类型 ============

export type CanvasMode = 'inpaint' | 'outpaint' | 'erase' | 'matting'

export interface CanvasProcessOptions {
  mode: CanvasMode
  /** 涂抹遮罩区域的 dataURL (PNG with alpha), 用于 inpaint/erase */
  mask?: string
  /** 扩图方向 (outpaint 专用): N/E/S/W/NE/NW/SE/SW/all */
  direction?: 'N' | 'E' | 'S' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'all'
  /** 扩展比例 (outpaint 专用), 默认 1.25 */
  expandRatio?: number
  /** inpaint 时填涂区域的提示词 */
  prompt?: string
}

export interface CanvasResult {
  url: string
  mode: CanvasMode
  /** mock 处理耗时 (毫秒) */
  processingTime: number
  /** 创建时间戳 */
  createdAt: number
}

export interface CanvasHistoryItem extends CanvasResult {
  id: string
  thumbnail: string
}

// ============ 多模态视频 (Video Multi) 类型 ============

export interface MultiModalVideoInput {
  /** 多图主体参考 (URL 数组) */
  subjectImages: string[]
  /** 文本提示词 */
  prompt: string
  /** 参考视频 URL (可选) */
  referenceVideo?: string
  /** 风格图 URL (可选) */
  styleImage?: string
  /** 时长 (秒) */
  duration: 5 | 10 | 15
  /** 比例 */
  ratio: '16:9' | '9:16' | '1:1' | '4:3'
  /** 模型 */
  model: 'sora2' | 'veo3.1'
}

export interface MultiModalVideoResult {
  id: string
  url: string
  thumbnail: string
  prompt: string
  model: string
  duration: number
  ratio: string
  createdAt: number
  status: 'processing' | 'success' | 'failed'
}

// ============ 多分镜批量 (Storyboard) 类型 ============

export type StoryboardShotType = 'image' | 'video'

export interface StoryboardShot {
  /** 客户端临时 id */
  id: string
  /** 序号 (从 1 开始, 由前端维护) */
  order: number
  /** 镜头描述 prompt */
  prompt: string
  /** 时长 (秒), 视频镜头专用 */
  duration: number
  /** 输出类型 */
  type: StoryboardShotType
  /** 模型 */
  model: 'sora2' | 'veo3.1' | 'imagen3' | 'flux'
  /** 生成结果 (批量生成后填充) */
  result?: {
    url: string
    thumbnail: string
    status: 'processing' | 'success' | 'failed'
  }
}

export interface StoryboardBatchResult {
  shotId: string
  url: string
  thumbnail: string
  status: 'success' | 'failed'
}

// ============ 音乐生成 (Music) 类型 ============

export type MusicStyle = 'pop' | 'electronic' | 'classical' | 'folk' | 'rap'
export type MusicDuration = 30 | 60 | 120

export interface MusicInput {
  /** 音乐描述 */
  description: string
  /** 风格预设 */
  style: MusicStyle
  /** 歌词 (可选) */
  lyrics?: string
  /** 时长 */
  duration: MusicDuration
  /** 变体数 (2-4) */
  variants: number
}

export interface MusicResult {
  id: string
  url: string
  title: string
  style: MusicStyle
  duration: number
  /** 模拟波形数据 (0-1 的振幅数组) */
  waveform: number[]
  createdAt: number
  favorite: boolean
}

// ============ 声音克隆 + TTS (Voice) 类型 ============

export type VoiceGender = 'male' | 'female'
export type VoiceAge = 'young' | 'adult' | 'middle' | 'senior'

export interface VoiceItem {
  id: string
  name: string
  gender: VoiceGender
  age: VoiceAge
  description: string
  /** 试听样本 URL */
  sampleUrl: string
  /** 标签 (中文/英文/童声/方言 等) */
  tags: string[]
  isCustom?: boolean
}

export interface VoiceCloneInput {
  /** 上传的样本音频 dataURL */
  audio: string
  /** 命名 */
  name: string
  /** 描述 */
  description?: string
}

export interface VoiceCloneResult {
  id: string
  name: string
  status: 'training' | 'ready' | 'failed'
  progress: number
  createdAt: number
}

export interface TtsInput {
  text: string
  voiceId: string
  /** 语速 0.5-2 */
  speed: number
  /** 情绪 */
  emotion: 'neutral' | 'happy' | 'sad' | 'angry'
}

export interface TtsResult {
  id: string
  url: string
  text: string
  voiceId: string
  voiceName: string
  duration: number
  createdAt: number
}

// ============ 常用工具 (Tools) 类型 ============

export type ToolCategory = 'portrait' | 'image' | 'audio' | 'video'
export type ToolInputType = 'single-image' | 'multi-image' | 'audio' | 'video'
export type ToolParamType = 'slider' | 'select' | 'switch' | 'textarea'

export interface ToolSelectOption {
  value: string
  labelKey: string
}

export interface ToolParam {
  key: string
  type: ToolParamType
  /** i18n key */
  labelKey: string
  /** 仅 slider */
  min?: number
  max?: number
  step?: number
  /** 仅 select */
  options?: ToolSelectOption[]
  /** 仅 textarea */
  rows?: number
  /** 仅 textarea */
  maxlength?: number
  /** i18n key, 可选 placeholder */
  placeholderKey?: string
  default: string | number | boolean
}

export interface ToolMeta {
  /** 路由 id, 如 'face-swap' */
  id: string
  category: ToolCategory
  /** Element Plus icon 名 */
  icon: string
  /** 工具名 i18n key, 如 'tools.face-swap.name' */
  nameKey: string
  /** 工具描述 i18n key */
  descKey: string
  input: ToolInputType
  /** 多图时最大张数 (仅 multi-image 适用) */
  maxImages?: number
  params: ToolParam[]
  cost: number
  badge?: 'new' | 'hot'
}

export interface ToolResult {
  url: string
  thumbnail?: string
  processingTime: number
  createdAt: number
}

export interface ToolHistoryItem extends ToolResult {
  id: string
  toolId: string
  params: Record<string, string | number | boolean>
}

export interface ToolProcessInput {
  images?: string[]
  audio?: string
  video?: string
}

// ============ 对话 (Chat) 类型 ============

export type ChatProvider = 'openai' | 'anthropic'
export type ChatApiType = 'OPENAI' | 'ANTHROPIC'
export type ChatMessageRole = 'user' | 'assistant' | 'system'
export type ChatMessageStatus = 'streaming' | 'success' | 'failed' | 'aborted'

/** 对话模型基础信息 */
export interface ChatModel {
  id: string
  /** 模型 code, 调用 API 时使用, 如 gpt-5.5 */
  modelCode: string
  /** 展示名称, 如 GPT-5.5 */
  modelName: string
  /** 模型厂牌 */
  provider: ChatProvider
  /** API 协议类型 */
  apiType: ChatApiType
  /** API 地址 */
  apiEndpoint: string
  /** API key (展示时需脱敏) */
  apiKey?: string
  /** 是否支持图片输入 */
  supportsImage: boolean
  /** 输入算力 (每百万 tokens) */
  inputCreditsPerM: number
  /** 输出算力 (每百万 tokens) */
  outputCreditsPerM: number
  /** 上下文上限 (tokens) - 后台可配, 默认 128000 */
  maxContextTokens: number
  /** 单次输出上限 (tokens) */
  maxOutputTokens: number
  /** 温度 */
  temperature?: number
  /** top_p */
  topP?: number
  /** 默认系统提示词 */
  systemPrompt?: string
  /** 排序 */
  sortOrder: number
  /** 角标 */
  isHot?: boolean
  isNew?: boolean
}

/** 后台管理对话模型 (含状态字段) */
export interface AdminChatModelVO extends ChatModel {
  status: 'enabled' | 'disabled'
  createdAt: string
  updatedAt: string
}

/** 会话基础信息 */
export interface ChatConversation {
  id: string
  userId?: string
  modelId: string
  title: string
  messageCount: number
  totalTokens: number
  lastMessageAt: number
  createdAt: number
}

/** 会话详情 (含模型回填) */
export interface ChatConversationVO extends ChatConversation {
  model?: ChatModel
}

/** 单条消息 */
export interface ChatMessage {
  id: string
  conversationId: string
  role: ChatMessageRole
  content: string
  /** 图片附件 URL (仅用户消息) */
  imageUrls?: string[]
  /** 输入 tokens */
  inputTokens: number
  /** 输出 tokens */
  outputTokens: number
  /** 本条消耗算力 */
  creditsCost: number
  /** 消息状态 */
  status: ChatMessageStatus
  /** 失败/中止原因 */
  errorMessage?: string
  /** 推理耗时 (ms) */
  durationMs?: number
  createdAt: number
}

/** 后台回填作者信息的消息 */
export interface ChatMessageVO extends ChatMessage {
  model?: ChatModel
}

/** 发送消息请求 */
export interface SendMessageRequest {
  conversationId: string
  content: string
  imageUrls?: string[]
  /** 中止信号 */
  signal?: AbortSignal
}

/** 流式事件 */
export type ChatStreamEvent =
  | { type: 'meta'; messageId: string }
  | { type: 'token'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; creditsCost: number }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; message: string }
  | { type: 'aborted' }

/** Token 估算请求 */
export interface EstimateRequest {
  modelId: string
  content: string
  imageUrls?: string[]
  historyTokens?: number
}

/** Token 估算响应 */
export interface EstimateResponse {
  inputTokens: number
  /** 估算的输出 tokens (按 maxOutputTokens / 2 估算) */
  estimatedOutputTokens: number
  /** 预计算力 */
  estimatedCredits: number
  /** 是否会超限 */
  willExceed: boolean
  /** 当前上下文占比 (0-1) */
  contextRatio: number
}

/** 新建会话请求 */
export interface CreateConversationRequest {
  modelId: string
  title?: string
}

// ==================== 提示词广场 ====================

/** 提示词案例分类 (13 类, 与 awesome-gpt-image-2 仓库分类一致) */
export type PromptCategory =
  | 'ui'
  | 'infographic'
  | 'poster'
  | 'product'
  | 'brand'
  | 'architecture'
  | 'photography'
  | 'illustration'
  | 'character'
  | 'scene'
  | 'classical'
  | 'document'
  | 'other'

/** 提示词案例对应的底层模型/引擎 (为未来视频/对话提示词留扩展位) */
export type PromptEngine = 'gpt-image-2' | 'sora2' | 'veo3.1' | 'gemini-3' | 'claude-4'

/** 提示词案例 (工业级 Prompt-as-Code 模板 + Gallery 案例, 数据源 awesome-gpt-image-2) */
export interface PromptCase {
  /** 唯一标识, 同时也是详情页路由参数 */
  id: string
  category: PromptCategory
  engine: PromptEngine
  /** 是否热门: 22 个工业模板恒为 true, 卡片显示 HOT 角标 */
  hot?: boolean
  /** 数据类型: template=工业模板(含 guidance/pitfalls), case=Gallery 案例(只有 fullPrompt) */
  kind?: 'template' | 'case'
  /** 中文标题 (直接用源数据原文) */
  title: string
  /** 中文描述 */
  description: string
  /** 适用场景说明 (仅 template 有) */
  useWhen: string
  /** 封面图 URL (/prompts/caseN.jpg, 图本地 COPY 在 public/prompts/) */
  thumbnail: string
  /** 期望长宽比, 如 '16:9' / '1:1' / '9:16' */
  aspectRatio?: string
  /** 业务标签 (UI/Dashboard/Campaign 等, 仅 template 有) */
  tags: string[]
  /** 视觉风格 (3D/摄影/插画 等, 仅 template 有) */
  styles: string[]
  /** 使用场景 (Education/Tech/Social 等, 仅 template 有) */
  scenes: string[]
  /** 6 段式拆解 - 引导要点 (仅 template 有) */
  guidance: string[]
  /** 6 段式拆解 - 避坑要点 (仅 template 有) */
  pitfalls: string[]
  /** 完整提示词 (可直接复用) */
  fullPrompt: string
  /** 源仓库案例编号引用, 仅作展示 (仅 template 有) */
  exampleCases?: number[]
  /** 案例来源 (仅 case 有, 如 "小红书号xxx") */
  source?: string
  /** 案例在源仓库的编号 (仅 case 有, 1-165) */
  caseNum?: number
}