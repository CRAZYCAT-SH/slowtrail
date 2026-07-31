import { useState } from 'react';
import type { SimilarFingerprintItem, FingerprintGroup } from '../../api';
import SQLBlock from '../SQLBlock';
import Button from '../Button';
import Select from '../Select';
import SqlDiffModal from './SqlDiffModal';
import { formatTime } from './utils';

interface Props {
  classifyingFp: string;
  similarItems: SimilarFingerprintItem[];
  similarLoading: boolean;
  selectedSimilar: Set<string>;
  groupName: string;
  existingGroups: FingerprintGroup[];
  selectedExistingGroupId: number | null;
  createMode: 'new' | 'existing';
  onClose: () => void;
  onToggleSimilar: (fp: string) => void;
  onSetGroupName: (name: string) => void;
  onSetCreateMode: (mode: 'new' | 'existing') => void;
  onSetExistingGroupId: (id: number | null) => void;
  onConfirm: () => void;
}

export default function ClassifyModal({
  classifyingFp,
  similarItems,
  similarLoading,
  selectedSimilar,
  groupName,
  existingGroups,
  selectedExistingGroupId,
  createMode,
  onClose,
  onToggleSimilar,
  onSetGroupName,
  onSetCreateMode,
  onSetExistingGroupId,
  onConfirm,
}: Props) {
  // 对比模态框状态：存储被对比的推荐指纹信息
  const [diffTarget, setDiffTarget] = useState<{ fingerprint: string; similarity: number } | null>(null);

  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-[1000] p-6 animate-[fadeIn_0.2s_ease-out]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[1200px] max-h-[85vh] flex flex-col animate-[modalSlideIn_0.25s_ease-out]" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="m-0 text-base font-semibold text-gray-900">归类指纹</h3>
          <button className="w-7.5 h-7.5 border-none bg-gray-100 rounded-full text-lg text-gray-400 cursor-pointer flex items-center justify-center shrink-0 hover:bg-gray-200 hover:text-gray-700" onClick={onClose}>×</button>
        </div>

        {/* 左右对比区域 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* 左侧：当前选中的指纹（固定） */}
          <div className="w-1/2 border-r border-gray-100 flex flex-col">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 shrink-0">
              <span className="text-xs font-medium text-gray-600">当前指纹</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <SQLBlock sql={classifyingFp} maxHeight={500} defaultFormatted />
            </div>
          </div>

          {/* 右侧：相似推荐列表（可滚动） */}
          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 shrink-0">
              <span className="text-xs font-medium text-gray-600">相似指纹推荐</span>
              {!similarLoading && similarItems.length > 0 && (
                <span className="text-[11px] text-gray-400 ml-2">（{similarItems.length} 条）</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {similarLoading ? (
                <div className="text-center py-8 text-gray-400 text-sm">加载推荐中...</div>
              ) : similarItems.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">未找到相似指纹</div>
              ) : (
                <div>
                  {similarItems.map((si) => (
                    <div
                      key={si.fingerprint}
                      className={`border-b border-gray-100 ${si.existingGroupId ? 'opacity-60' : ''} ${selectedSimilar.has(si.fingerprint) ? 'bg-primary/5' : ''}`}
                    >
                      <label className="flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={selectedSimilar.has(si.fingerprint)}
                          onChange={() => onToggleSimilar(si.fingerprint)}
                          disabled={!!si.existingGroupId}
                        />
                        <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap flex-1">
                          <span>相似度: <strong className="text-primary">{Math.round(si.similarity * 100)}%</strong></span>
                          <span>频次: {si.count}</span>
                          <span>平均耗时: {formatTime(si.avgQueryTime)}</span>
                          {si.existingGroupName && (
                            <span className="text-orange-500">已归类: {si.existingGroupName}</span>
                          )}
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDiffTarget({ fingerprint: si.fingerprint, similarity: si.similarity }); }}
                          title="对比当前指纹与此推荐指纹的差异"
                        >对比</Button>
                      </label>
                      <div className="px-4 pb-3">
                        <SQLBlock sql={si.fingerprint} maxHeight={200} defaultFormatted />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部：分类选择 + 操作按钮 */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                <input type="radio" name="createMode" checked={createMode === 'new'} onChange={() => onSetCreateMode('new')} />
                新建分类
              </label>
              {existingGroups.length > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input type="radio" name="createMode" checked={createMode === 'existing'} onChange={() => onSetCreateMode('existing')} />
                  添加到已有分类
                </label>
              )}
            </div>

            <div className="flex-1 min-w-[200px]">
              {createMode === 'new' ? (
                <input
                  type="text"
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                  placeholder="输入分类名称（如：订单查询、用户列表）"
                  value={groupName}
                  onChange={(e) => onSetGroupName(e.target.value)}
                />
              ) : (
                <Select
                  value={String(selectedExistingGroupId || '')}
                  onChange={(v) => onSetExistingGroupId(v ? Number(v) : null)}
                  placeholder="选择已有分类..."
                  options={[
                    { value: '', label: '选择已有分类...' },
                    ...existingGroups.map((g) => ({ value: String(g.id), label: `${g.name} (${g.fingerprints.length} 个指纹)` })),
                  ]}
                  className="w-full"
                />
              )}
            </div>

            <div className="flex gap-2 shrink-0">
              <Button variant="secondary" onClick={onClose}>取消</Button>
              <Button
                variant="primary"
                disabled={createMode === 'new' ? !groupName.trim() : !selectedExistingGroupId}
                onClick={onConfirm}
              >确认归类</Button>
            </div>
          </div>
        </div>
      </div>

      {/* SQL 差异对比模态框 */}
      {diffTarget && (
        <SqlDiffModal
          sourceSql={classifyingFp}
          targetSql={diffTarget.fingerprint}
          similarity={diffTarget.similarity}
          onClose={() => setDiffTarget(null)}
        />
      )}
    </div>
  );
}
