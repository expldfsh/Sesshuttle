import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { StatusBadge } from '../components/StatusBadge';
import { hasMissingImages, projectLabel } from './rows';

// Rows have one fixed height (set in CSS, measured once) so long lists can be windowed.
export const ROW_HEIGHT = 64;
const WINDOW_FROM = 100,
  OVERSCAN = 8;

// Render counts, read by the test-mode performance check.
export const renderStats = { table: 0, rows: 0 };
(globalThis as any).sesshuttleRenderStats = renderStats;

type Props = {
  rows: any[];
  selected: Set<string>;
  focus: string | null;
  onToggle: (id: string, checked: boolean) => void;
  onFocus: (id: string) => void;
  onSelectAll: (checked: boolean) => void;
  empty: ReactNode;
};

export const ConversationTable = memo(function ConversationTable({
  rows,
  selected,
  focus,
  onToggle,
  onFocus,
  onSelectAll,
  empty,
}: Props) {
  renderStats.table++;
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0),
    [height, setHeight] = useState(600),
    [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  useLayoutEffect(() => {
    const el = scroller.current!;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const measured = scroller.current
      ?.querySelector<HTMLElement>('tr.conversation-row')
      ?.getBoundingClientRect().height;
    if (measured && Math.abs(measured - rowHeight) > 0.01) setRowHeight(measured);
  }, [rows, rowHeight]);
  // A new filter starts at the top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollTop(0);
  }, [rows]);
  const windowed = rows.length > WINDOW_FROM;
  const start = windowed ? Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN) : 0;
  const end = windowed
    ? Math.min(rows.length, Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN)
    : rows.length;
  const spacer = (count: number) => (
    <tr className="spacer" aria-hidden="true">
      <td colSpan={5} style={{ height: count * rowHeight }} />
    </tr>
  );
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div
      className="table-scroll"
      ref={scroller}
      onScroll={windowed ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
    >
      <table aria-rowcount={rows.length + 1}>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label={t('selectAll')}
                checked={allChecked}
                onChange={(e) => onSelectAll(e.target.checked)}
              />
            </th>
            <th>{t('title')}</th>
            <th>{t('source')}</th>
            <th>{t('localSize')}</th>
            <th>{t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {start > 0 && spacer(start)}
          {rows.slice(start, end).map((r, i) => (
            <ConversationRow
              key={r.id}
              row={r}
              index={start + i}
              checked={selected.has(r.id)}
              focused={focus === r.id}
              onToggle={onToggle}
              onFocus={onFocus}
            />
          ))}
          {end < rows.length && spacer(rows.length - end)}
        </tbody>
      </table>
      {!rows.length && empty}
    </div>
  );
});

const ConversationRow = memo(function ConversationRow({
  row: r,
  index,
  checked,
  focused,
  onToggle,
  onFocus,
}: {
  row: any;
  index: number;
  checked: boolean;
  focused: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onFocus: (id: string) => void;
}) {
  renderStats.rows++;
  const { t, size } = useI18n();
  return (
    <tr
      tabIndex={0}
      aria-rowindex={index + 2}
      className={'conversation-row' + (focused ? ' focused' : '')}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onFocus(r.id);
        }
      }}
      onClick={() => onFocus(r.id)}
    >
      <td>
        <input
          type="checkbox"
          aria-label={r.title}
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(r.id, e.target.checked)}
        />
      </td>
      <td>
        <strong>{r.title}</strong>
        <small>
          {r.archived ? t('archive') + ' · ' : ''}
          {projectLabel(r, t)}
        </small>
      </td>
      <td>
        <span className="source-tag">{t(r.source)}</span>
      </td>
      <td className="size-cell">
        {r.local ? size(r.bytes) : '—'}
        {r.compressed && <small>{t('compressedHistory')}</small>}
        {r.databaseBytes > 0 && <small>{t('hasLocalDatabase')}</small>}
      </td>
      <td>
        <StatusBadge status={r.status} />
        {r.busy && <StatusBadge status="busy" />}
        {hasMissingImages(r) && <small className="amber-text">{t('someImagesMissing')}</small>}
      </td>
    </tr>
  );
});
