// Synthetic category text only. Exercise the actual native control and handler.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './test-support/register.mjs';

const root=path.resolve(import.meta.dirname,'..');
await mkdir(path.join(root,'.sites-runtime'),{recursive:true});
const temp=await mkdtemp(path.join(root,'.sites-runtime','category-filter-'));
try{
 const code=ts.transpileModule(await readFile(path.join(root,'app/category-filter.tsx'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/(['"])@\/lib\/([^'"]+)\1/g,(_,quote,name)=>JSON.stringify(pathToFileURL(path.join(root,'lib',name+'.ts')).href));
 const target=path.join(temp,'category-filter.mjs');await writeFile(target,code);
 const Filter=(await import(pathToFileURL(target))).default;
 const canary='Legacy travel USD 350.00',missing='Older category $987.65',categories=['Shopping',canary,'Travel'],before=[...categories],calls=[];
 const base={categories,value:canary,hidden:true,label:'Category filter',allLabel:'All categories',className:'chart-select',onChange:value=>calls.push(value)};
 const native=extra=>Filter({...base,...extra});
 const render=extra=>renderToStaticMarkup(React.createElement(Filter,{...base,...extra}));
 const options=element=>React.Children.toArray(element.props.children).filter(child=>React.isValidElement(child)&&child.type==='option');
 const hidden=render({});
 assert.doesNotMatch(hidden,/350\.00|USD 350|Legacy travel USD|title=/,'Hidden monetary text is absent from labels and every rendered attribute');
 assert.match(hidden,/Legacy travel ••••/,'Amount hiding retains useful category identity');
 assert.match(hidden,/<option value="category-1" selected="">/);
 assert.equal(native({}).props.value,'category-1');
 assert.deepEqual(options(native({})).map(option=>option.props.value),['all','category-0','category-1','category-2'],'Only opaque indices and the existing all sentinel reach option values');
 assert.equal(native({}).props['aria-label'],'Category filter');assert.equal(native({}).props.className,'chart-select');
 assert.deepEqual(calls,[],'Rendering never resets raw selected state');
 native({}).props.onChange({target:{value:'category-1'}});assert.deepEqual(calls,[canary],'A native selection maps back to the exact raw category, not its masked label');
 native({}).props.onChange({target:{value:'category-2'}});assert.deepEqual(calls,[canary,'Travel']);
 native({}).props.onChange({target:{value:'all'}});assert.equal(calls.at(-1),'all');
 const validCalls=[...calls];
 for(const value of ['missing','category--1','category-01','category-1.0','category-1suffix','category-3','category-999999999999999999999999','',canary])native({}).props.onChange({target:{value}});
 assert.deepEqual(calls,validCalls,'Malformed, stale and out-of-range indices cannot become raw filter state');
 const shown=render({hidden:false});assert.match(shown,/Legacy travel USD 350\.00/);assert.doesNotMatch(shown,/value="Legacy travel/,'Showing amounts restores labels but keeps option values opaque');
 assert.equal(native({hidden:false}).props.value,native({hidden:true}).props.value,'Toggling privacy preserves selection');
 const all=render({value:'all'});assert.match(all,/<option value="all" selected="">All categories<\/option>/);
 assert.equal(native({categories:[canary,'Travel','Shopping']}).props.value,'category-0','Reordered available categories preserve the raw selected value');
 const absent=native({value:missing}),absentOption=options(absent).find(option=>option.props.value==='missing');
 assert.equal(absent.props.value,'missing');assert.equal(absentOption.props.disabled,true);assert.match(render({value:missing}),/Older category •••• · unavailable in this list/);assert.doesNotMatch(render({value:missing}),/987\.65|value="Older category/,'Unavailable raw selections are represented without being leaked or reset');
 assert.match(render({value:missing,hidden:false}),/Older category \$987\.65/);
 assert.equal(native({categories:[],value:'all'}).props.value,'all');
 assert.equal(native({categories:[],value:missing}).props.value,'missing');
 assert.doesNotMatch(render({label:'Category USD 350.00',allLabel:'All $350.00 categories'}),/350\.00/,'Accessible labels use the same amounts-only mask');
 assert.deepEqual(calls,validCalls);assert.deepEqual(categories,before,'Display and missing-selection handling never mutate categories or saved selection');
}finally{await rm(temp,{recursive:true,force:true});}
console.log('Category filter passed: opaque option values, masked labels/ARIA, exact raw selection mapping, guarded indices, preserved missing selections and privacy restoration.');
