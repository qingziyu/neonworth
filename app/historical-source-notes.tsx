import {ChevronDown} from 'lucide-react';
import {refreshTextForDisplay} from '@/lib/refresh-status';

export default function HistoricalSourceNotes({notes,hidden}:{notes:string[];hidden:boolean}){
 return <><h2>Original import notes</h2><p className="small-note">Historical source context, preserved as recorded. These notes can describe earlier rules, counts or source dates; current accounting and coverage are shown above.</p><details className="source-note-details"><summary>Read historical import notes <ChevronDown size={13}/></summary>{notes.map((note,index)=><p className="data-note" key={index}>{refreshTextForDisplay(note,hidden)}</p>)}</details></>;
}
