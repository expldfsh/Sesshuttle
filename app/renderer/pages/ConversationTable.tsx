import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { StatusBadge } from '../components/StatusBadge';
import { Icon } from '../components/Icon';
import { hasMissingImages, projectLabel } from './rows';

// Rows have one fixed height (set in CSS, measured once) so long lists can be windowed.
export const ROW_HEIGHT = 64;
const WINDOW_FROM = 100,
  OVERSCAN = 8;

// Render counts, read by the test-mode performance check.
export const renderStats = { table: 0, rows: 0 };
(globalThis as any).sesshuttleRenderStats = renderStats;

type Sort = { key: 'updated' | 'title' | 'size'; descending: boolean };
type Props = {
  rows: any[];
  selected: Set<string>;
  focus: string | null;
  sort: Sort;
  onSort: (sort: Sort) => void;
  onToggle: (id: string, checked: boolean) => void;
  onFocus: (id: string) => void;
  onSelectAll: (checked: boolean) => void;
  onSelect: (selected: Set<string>) => void;
  empty: ReactNode;
  // Leaves room for the floating selection bar.
  padded: boolean;
};

export const ConversationTable = memo(function ConversationTable({
  rows,
  selected,
  focus,
  sort,
  onSort,
  onToggle,
  onFocus,
  onSelectAll,
  empty,
  padded,
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
      <td colSpan={6} style={{ height: count * rowHeight }} />
    </tr>
  );
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  // Keeps the focused row inside the scrolled window, below the sticky header.
  function reveal(index: number) {
    const el = scroller.current;
    if (!el) return;
    const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const reserve = padded ? 72 : 0;
    const top = index * rowHeight,
      bottom = top + rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight - head - reserve)
      el.scrollTop = bottom - el.clientHeight + head + reserve;
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.target !== event.currentTarget || !rows.length) return;
    const index = rows.findIndex((r) => r.id === focus);
    const move = (next: number) => {
      event.preventDefault();
      onFocus(rows[next].id);
      reveal(next);
    };
    if (event.key === 'ArrowDown') move(index < 0 ? 0 : Math.min(rows.length - 1, index + 1));
    else if (event.key === 'ArrowUp') move(index < 0 ? 0 : Math.max(0, index - 1));
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(rows.length - 1);
    else if (event.key === ' ' && index >= 0) {
      event.preventDefault();
      onToggle(rows[index].id, !selected.has(rows[index].id));
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelectAll(true);
    }
  }
  const sortHeader = (key: Sort['key'], label: string) => {
    const active = sort.key === key;
    return (
      <th aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
        <button
          type="button"
          className={'sort-button' + (active ? ' active' : '')}
          onClick={() => onSort({ key, descending: active ? !sort.descending : key !== 'title' })}
        >
          {label}
          {active && <Icon name="chevron" className={sort.descending ? 'sort-down' : 'sort-up'} />}
        </button>
      </th>
    );
  };
  return (
    <div
      className={'table-scroll' + (padded ? ' padded' : '')}
      ref={scroller}
      onScroll={windowed ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
    >
      <table
        role="grid"
        aria-label={t('conversations')}
        aria-multiselectable="true"
        aria-rowcount={rows.length + 1}
        tabIndex={0}
        aria-activedescendant={
          focus && rows.some((r) => r.id === focus) ? 'row-' + focus : undefined
        }
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            <th className="check-cell">
              <input
                type="checkbox"
                aria-label={t('selectAll')}
                checked={allChecked}
                onChange={(e) => onSelectAll(e.target.checked)}
              />
            </th>
            {sortHeader('title', t('title'))}
            <th>{t('source')}</th>
            <th>{t('location')}</th>
            {sortHeader('size', t('localSize'))}
            <th
              aria-sort={
                sort.key === 'updated' ? (sort.descending ? 'descending' : 'ascending') : 'none'
              }
            >
              <span className="status-head">
                {t('status')}
                <button
                  type="button"
                  className={'sort-button small' + (sort.key === 'updated' ? ' active' : '')}
                  title={t('sortByUpdated')}
                  aria-label={t('sortByUpdated')}
                  onClick={() =>
                    onSort({
                      key: 'updated',
                      descending: sort.key === 'updated' ? !sort.descending : true,
                    })
                  }
                >
                  <Icon name="history" />
                  {sort.key === 'updated' && (
                    <Icon name="chevron" className={sort.descending ? 'sort-down' : 'sort-up'} />
                  )}
                </button>
              </span>
            </th>
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
  const where = r.local && r.remote ? 'locationBoth' : r.local ? 'locationLocal' : 'locationCloud';
  return (
    <tr
      id={'row-' + r.id}
      aria-rowindex={index + 2}
      aria-selected={checked}
      className={'conversation-row' + (focused ? ' focused' : '')}
      onClick={(e) => {
        onFocus(r.id);
        (e.currentTarget.closest('table') as HTMLElement | null)?.focus({ preventScroll: true });
      }}
    >
      <td className="check-cell">
        <input
          type="checkbox"
          tabIndex={-1}
          aria-label={r.title}
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(r.id, e.target.checked)}
        />
      </td>
      <td className="title-cell">
        <strong>{r.title}</strong>
        <small>
          {r.archived && <span className="mini-tag">{t('archive')}</span>}
          {projectLabel(r, t)}
        </small>
      </td>
      <td>
        <span className="source-tag">{t(r.source)}</span>
      </td>
      <td className="location-cell" aria-label={t(where)} title={t(where)}>
        <Icon name="laptop" className={r.local ? 'present' : 'absent'} />
        <Icon name="cloud" className={r.remote ? 'present' : 'absent'} />
      </td>
      <td className="size-cell">
        {r.bytes ? size(r.bytes) : '—'}
        {(r.compressed || r.databaseBytes > 0) && (
          <small>{r.compressed ? t('compressedHistory') : t('hasLocalDatabase')}</small>
        )}
      </td>
      <td className="status-cell">
        <StatusBadge status={r.status} />
        {r.busy && <StatusBadge status="busy" />}
        {hasMissingImages(r) && <small className="amber-text">{t('someImagesMissing')}</small>}
      </td>
    </tr>
  );
});
