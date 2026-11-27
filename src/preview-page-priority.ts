// A viewport hint is not a pagination input. Copy and validate it before any
// asynchronous work so callers cannot reorder a running render.
export function snapshotPagePriority(value:readonly number[]|undefined):readonly number[]|undefined{
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>64)throw RangeError('Invalid preview page priority');
  const result:number[]=[];
  const seen=new Set<number>();
  for(const index of value){
    if(!Number.isSafeInteger(index)||index<0)throw RangeError('Invalid preview page priority index');
    if(!seen.has(index)){seen.add(index);result.push(index);}
  }
  return result.length?Object.freeze(result):undefined;
}
export function prioritizePages<T extends {index:number}>(pages:readonly T[],priority:readonly number[]|undefined):readonly T[]{
  if(!priority?.length)return pages;
  const byIndex=new Map(pages.map(page=>[page.index,page]));
  const selected:T[]=[];
  for(const index of priority){
    const page=byIndex.get(index);
    if(page){selected.push(page);byIndex.delete(index);}
  }
  // Missing indices are normal when an edit shortens the book.
  return [...selected,...byIndex.values()];
}
