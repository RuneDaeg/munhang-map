import type { PageText } from './pdf-layout';
import type { PdfStructure, Rule } from './pdf-structures';
import { styledItemText } from './pdf-source-formatting';

/** A ruled timeline is not a table: labels occupy intervals between event ticks.
 * Keep that relation explicitly, without inventing dates or event descriptions.
 */
export function detectPdfTimelines(items: PageText[], rules: Rule[]): PdfStructure[] {
  if (!items.some(i => i.text.includes('연표'))) return [];
  const vertical = rules.filter(r => r.x2 - r.x1 < .7 && r.y2 - r.y1 > 8);
  const groups: Rule[][] = [];
  for (const r of vertical) {
    const group = groups.find(g => Math.abs(g[0].y1 - r.y1) < 1.5 && Math.abs(g[0].y2 - r.y2) < 1.5);
    if (group) group.push(r); else groups.push([r]);
  }
  const textOf = (content: PageText[]) => {
    const rows: PageText[][] = [];
    for (const i of [...content].sort((a,b) => a.y-b.y || a.x-b.x)) {
      const row = rows.find(r => Math.abs(r[0].y-i.y) < Math.max(2,i.height*.3));
      if (row) row.push(i); else rows.push([i]);
    }
    return rows.map(r => r.sort((a,b)=>a.x-b.x).map(styledItemText).join(' ')).join(' ');
  };
  const found: PdfStructure[] = [];
  for (const group of groups) {
    const ordered = [...group].sort((a,b)=>a.x1-b.x1);
    const ticks = ordered.filter((r,i)=>!i || r.x1-ordered[i-1].x1>2).map(r=>r.x1);
    if (ticks.length < 4 || ticks.length > 12) continue;
    const top=group[0].y1, bottom=group[0].y2;
    const lines=rules.filter(r=>r.y2-r.y1<.7 && r.x1<=ticks[0]+2 && r.x2>=ticks.at(-1)!-2);
    if (![top,bottom].every(y=>lines.some(r=>Math.abs(r.y1-y)<1.5))) continue;
    const gaps=ticks.slice(1).map((x,i)=>x-ticks[i]);
    if (Math.min(...gaps)<15 || Math.max(...gaps)>Math.min(...gaps)*1.5) continue;
    const labels=ticks.slice(0,-1).map((x,n)=>items.filter(i=>i.x+i.width/2>x && i.x+i.width/2<ticks[n+1] && i.y+i.height/2>top && i.y+i.height/2<bottom));
    if (labels.some(part=>!/^\(\s*[가-힣A-Z]\s*\)$/.test(textOf(part)))) continue;
    const height=Math.max(...labels.flat().map(i=>i.height));
    const left=ticks[0]-gaps[0]*.5, right=ticks.at(-1)!+gaps.at(-1)!*.5;
    const choiceTop=Math.min(bottom+height*3,...items.filter(i=>i.y>=bottom && i.x>=left && i.x<right && /[①-⑤]/.test(i.text)).map(i=>i.y));
    const events=Array.from({length:ticks.length},()=>[] as PageText[]);
    for (const i of items) {
      const center=i.x+i.width/2;
      if (i.y<bottom-1 || i.y+i.height>choiceTop || center<left || center>right) continue;
      const nearest=ticks.reduce((best,x,n)=>Math.abs(x-center)<Math.abs(ticks[best]-center)?n:best,0);
      events[nearest].push(i);
    }
    if (events.some(part=>!/[가-힣]{2}/.test(textOf(part)) || /[①-⑤?]/.test(textOf(part)))) continue;
    const sourceItems=[...labels.flat(),...events.flat()];
    const pieces=events.flatMap((part,n)=>n ? [textOf(labels[n-1]),textOf(part)] : [textOf(part)]);
    found.push({x:Math.min(left,...sourceItems.map(i=>i.x)),y:top,
      width:Math.max(right,...sourceItems.map(i=>i.x+i.width))-Math.min(left,...sourceItems.map(i=>i.x)),
      height:Math.max(...sourceItems.map(i=>i.y+i.height))-top,
      kind:'box',title:'연표',text:pieces.join(' → '),rows:[],header:false,sourceItems});
  }
  return found;
}
