import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

type Option = {value: string; label: string};
type Props = {label: string; value: string; options: Option[]; onChange: (value: string)=>void; disabled?: boolean};

export function Select({label, value, options, onChange, disabled = false}: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLDivElement|null)[]>([]);
  const search = useRef({text: '', at: 0});
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({left: 0, top: 0, width: 0, maxHeight: 384});
  const selected = options.findIndex(option=>option.value === value);

  function show(index = Math.max(0, selected)) {
    if (disabled || !options.length) return;
    setActive(index); setOpen(true); search.current = {text: '', at: 0};
  }
  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value); setOpen(false); trigger.current?.focus({preventScroll: true});
  }
  useEffect(()=>{ if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(()=>{
    if (!open) return;
    const update = ()=>{
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const below = window.innerHeight - anchor.bottom - 14, above = anchor.top - 14;
      const desired = Math.min(menu.current?.scrollHeight || 384, 384);
      const upward = below < desired && above > below;
      const maxHeight = Math.min(384, Math.max(80, upward ? above : below));
      const width = Math.min(Math.max(anchor.width, 180), window.innerWidth - 24);
      const next = {
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
        top: upward ? Math.max(8, anchor.top - Math.min(desired, maxHeight) - 6) : anchor.bottom + 6,
        width, maxHeight,
      };
      setPosition(old=>Object.entries(next).every(([key,v])=>old[key as keyof typeof old] === v) ? old : next);
    };
    const outside = (event: PointerEvent)=>{
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const observer = new ResizeObserver(update);
    if (trigger.current) observer.observe(trigger.current);
    if (menu.current) observer.observe(menu.current);
    update();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return ()=>{
      observer.disconnect(); document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true);
    };
  }, [open, options.length]);
  useLayoutEffect(()=>{
    if (!open) return;
    const option = items.current[active], list = menu.current;
    if (!option || !list) return;
    const top = option.offsetTop, bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [open, active, position.maxHeight]);

  return <>
    <button ref={trigger} type="button" className="select-trigger" role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined}
      disabled={disabled} onClick={()=>open ? setOpen(false) : show()} onBlur={()=>setOpen(false)}
      onKeyDown={event=>{
        if (event.key === 'Tab') { setOpen(false); return; }
        if (event.key === 'Escape') { if (open) {event.preventDefault(); event.stopPropagation(); setOpen(false);} return; }
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'Home') show(0);
          else if (event.key === 'End') show(options.length - 1);
          else if (!open) show();
          else setActive(index=>Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); open ? choose(active) : show(); return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          const now = performance.now();
          const text = (now - search.current.at < 700 ? search.current.text : '') + event.key.toLocaleLowerCase();
          search.current = {text, at: now};
          const prefix = new Set(text).size === 1 ? text[0] : text;
          const start = open ? active : Math.max(0, selected);
          const order = options.map((_,index)=>(start + 1 + index) % options.length);
          const found = order.find(index=>options[index].label.toLocaleLowerCase().startsWith(prefix));
          if (found !== undefined) { setActive(found); setOpen(true); }
        }
      }}>
      <span>{options[selected]?.label ?? '—'}</span><span className="select-caret" aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} className="select-menu"
      style={{...position, visibility: position.width ? 'visible' : 'hidden'}} onMouseDown={event=>event.preventDefault()}>
      {options.map((option,index)=><div key={option.value} id={`${id}-${index}`} role="option"
        ref={element=>{items.current[index] = element;}} aria-selected={value === option.value}
        className={`select-option${index === active ? ' active' : ''}`}
        onPointerMove={()=>setActive(index)} onClick={()=>choose(index)}>
        <span>{option.label}</span><span className="select-check" aria-hidden="true">{value === option.value ? '✓' : ''}</span>
      </div>)}
    </div>, document.body)}
  </>;
}
