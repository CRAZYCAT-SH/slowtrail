import { Router, Request, Response } from 'express';
import {
  createGroup,
  deleteGroup,
  updateGroupName,
  addFingerprintsToGroup,
  removeFingerprintFromGroup,
  getGroups,
  getGroupById,
  getSimilarFingerprints,
} from '../services/groupService';
import { QueryFilter } from '../services/statsService';

const router = Router();

/**
 * GET /api/fingerprint-groups
 * 获取所有分类列表（含成员指纹）
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const groups = getGroups();
    res.json({ success: true, data: groups });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取分类列表失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/fingerprint-groups/similar
 * 获取相似指纹推荐
 * Query: fingerprint (必填), startTime, endTime, dbName, instanceName, limit
 */
router.get('/similar', (req: Request, res: Response) => {
  try {
    const fingerprint = req.query.fingerprint as string;
    if (!fingerprint) {
      res.status(400).json({ success: false, error: '缺少必填参数: fingerprint' });
      return;
    }

    const filter: QueryFilter = {
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      dbName: req.query.dbName as string | undefined,
      instanceName: req.query.instanceName as string | undefined,
    };

    const limit = parseInt(req.query.limit as string) || 20;

    const results = getSimilarFingerprints(fingerprint, filter, limit);
    res.json({ success: true, data: results });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取相似指纹推荐失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/fingerprint-groups
 * 创建分类
 * Body: { name: string, fingerprints: string[] }
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, fingerprints } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ success: false, error: '分类名称不能为空' });
      return;
    }
    if (!fingerprints || !Array.isArray(fingerprints) || fingerprints.length === 0) {
      res.status(400).json({ success: false, error: '至少需要包含一个指纹' });
      return;
    }

    const group = createGroup(name.trim(), fingerprints);
    res.json({ success: true, data: group });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 创建分类失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/fingerprint-groups/:id
 * 修改分类名称
 * Body: { name: string }
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const { name } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, error: '分类名称不能为空' });
      return;
    }

    const existing = getGroupById(groupId);
    if (!existing) {
      res.status(404).json({ success: false, error: '分类不存在' });
      return;
    }

    updateGroupName(groupId, name.trim());
    res.json({ success: true, data: { ...existing, name: name.trim() } });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 修改分类名称失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/fingerprint-groups/:id
 * 删除分类
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const groupId = parseInt(req.params.id as string);

    const existing = getGroupById(groupId);
    if (!existing) {
      res.status(404).json({ success: false, error: '分类不存在' });
      return;
    }

    deleteGroup(groupId);
    res.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 删除分类失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/fingerprint-groups/:id/fingerprints
 * 向分类添加指纹
 * Body: { fingerprints: string[] }
 */
router.post('/:id/fingerprints', (req: Request, res: Response) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const { fingerprints } = req.body;

    if (!fingerprints || !Array.isArray(fingerprints) || fingerprints.length === 0) {
      res.status(400).json({ success: false, error: '至少需要包含一个指纹' });
      return;
    }

    const existing = getGroupById(groupId);
    if (!existing) {
      res.status(404).json({ success: false, error: '分类不存在' });
      return;
    }

    const addedCount = addFingerprintsToGroup(groupId, fingerprints);
    res.json({ success: true, data: { addedCount } });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 添加指纹到分类失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/fingerprint-groups/:id/fingerprints/:fingerprint
 * 从分类移除指纹
 */
router.delete('/:id/fingerprints/:fingerprint', (req: Request, res: Response) => {
  try {
    const fingerprint = decodeURIComponent(req.params.fingerprint as string);

    removeFingerprintFromGroup(fingerprint);
    res.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 从分类移除指纹失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
