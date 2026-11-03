from pathlib import Path
import json,re,html
from urllib.parse import urljoin
outdir=Path(__file__).parent
p=outdir/"raw"
# Restore decoded sample-page inputs from the saved original extraction.
parts=re.split(r"\n\n===== PAGE (\d+) =====\n",(p/"alameda-composite-guide.txt").read_text())
for i in range(1,len(parts),2):
 text=parts[i+1]
 if "Sample Ballot" in text:
  decoded="".join(chr(ord(c)+29) if c not in "\n\r\t " and ord(c)<130 else (" " if c=="¬" else c) for c in text)
  (p/("sample-page-"+parts[i]+".txt")).write_text(decoded)
county='https://acvote.alamedacountyca.gov/election-information/elections?id=260'
guide='https://acvote.alamedacountyca.gov/acvote-assets/02_election_information/PDFs/20261103/Voter%20Information%20Guide/vig_nov2026_eng.pdf'
candidates='https://alamedacountyca.gov/rov_app/candidatelist'
state='https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/cert-list-candidates.pdf'
def slug(s):return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')
raw=json.loads((p/'candidate-inventory-raw.json').read_text())
contests=[]
for title,data in raw.items():
 ranked=('Oakland' in title or 'Albany' in title or ('Berkeley' in title and ('City Council' in title or 'Auditor' in title)))
 n=data['voteFor']
 if ranked:n=min(5,len(data['names'])+1) if 'Oakland' in title else 5
 jurisdiction=next((f'City of {x}' for x in ['Alameda','Albany','Berkeley','Dublin','Emeryville','Fremont','Hayward','Livermore','Newark','Oakland','Piedmont','Pleasanton','San Leandro','Union City'] if title.endswith(', '+x)),title if 'District' in title or 'Dist #' in title else 'California')
 contests.append(dict(id=slug(title),title=title,type='candidate',jurisdiction=jurisdiction,options=data['names'],maxSelections=n,ranked=ranked,seats=data['voteFor'],sourceUrls=[candidates,guide],writeInPolicy='Printed candidates only; qualified write-ins, if any, require separate verification.'))
retentions=[('Kelli M. Evans','Associate Justice of the Supreme Court'),('Joshua Groban','Associate Justice of the Supreme Court'),('Charles A. Smiley','Associate Justice, Court of Appeal, First District, Division One'),('Kathleen M. Banke','Associate Justice, Court of Appeal, First District, Division One'),('Monique Langhorne Wilson','Associate Justice, Court of Appeal, First District, Division One'),('Therese M. Stewart','Presiding Justice, Court of Appeal, First District, Division Two'),('Tara M. Desautels','Associate Justice, Court of Appeal, First District, Division Two'),('Ioana Petrou','Associate Justice, Court of Appeal, First District, Division Three'),('Victor A. Rodriguez','Associate Justice, Court of Appeal, First District, Division Three'),('Tracie L. Brown','Presiding Justice, Court of Appeal, First District, Division Four'),('Mark Simons','Associate Justice, Court of Appeal, First District, Division Five'),('Danny Y. Chou','Associate Justice, Court of Appeal, First District, Division Five'),('Gordon Burns','Associate Justice, Court of Appeal, First District, Division Five')]
for name,office in retentions:
 contests.append(dict(id='retention-'+slug(name),title=f'{office}: {name}',type='retention',jurisdiction='California' if 'Supreme' in office else 'First Appellate District',options=['Yes','No'],maxSelections=1,ranked=False,sourceUrls=[state,guide]))
s=(p/'propositions.html').read_text()
for path,text in re.findall(r'<a href="(/propositions/\d+/)">(.*?)</a>',s):
 title='Proposition '+html.unescape(re.sub('<[^>]*>','',text));num=re.search(r'\d+',path)[0]
 if any(c['id']=='ca-proposition-'+num for c in contests):continue
 contests.append(dict(id='ca-proposition-'+num,title=title,type='measure',jurisdiction='California',options=['Yes','No'],maxSelections=1,ranked=False,sourceUrls=[urljoin('https://voterguide.sos.ca.gov',path)]))
s=(p/'election.html').read_text()
for title,path in re.findall(r'<a title="(Measure [^"]+)" href="([^"]+)"',s):
 code=title.split(' ')[1];parts=title.split(' - ')
 jurisdiction=parts[1] if len(parts)>2 else 'Public Transit Revenue Measure District'
 contests.append(dict(id='alameda-measure-'+code.lower(),title=html.unescape(title),type='measure',jurisdiction=jurisdiction,options=['Yes','No'],maxSelections=1,ranked=False,sourceUrls=[urljoin('https://acvote.alamedacountyca.gov',path),county]))
result=dict(electionDate='2026-11-03',scope='Alameda County composite: union of all contests appearing on county ballot variants; no individual voter receives this entire composite.',sources=[{'url':county,'title':'Official county election page'},{'url':guide,'title':'Official Alameda County composite voter information guide (965 PDF pages)'},{'url':candidates,'title':'Official on-ballot candidate search, electionId=260, raceStatus=onballot, candidateStatus=COMPLETED'},{'url':state,'title':'State certified candidates and judicial retention list, August 27 2026'},{'url':'https://voterguide.sos.ca.gov/propositions/','title':'Official statewide propositions'}],contests=contests,methodology={'retrievedDate':'2026-10-27','candidateSearch':'POST electionId=260&categoryId=&raceId=&lastName=&raceStatus=onballot&candidateStatus=COMPLETED to '+candidates+'/','deduplication':'Official race title; candidate search desktop and mobile renderings merged. Excludes races marked Not On Ballot.','retentionVerification':'State certified list PDF pages 34–35 and county sample ballot pages 180–183. All 13 appear on BT48.','rankedVerification':'Albany and Berkeley municipal ranked ballots allow 5 rankings. Oakland ranks equal printed candidates plus write-in slot (maximum 5). San Leandro sample ballots use Vote for One and are not marked ranked.','writeIns':'Options contain printed candidate names; no assertion that these exhaust any late qualified write-ins.','limitations':'A county composite spans mutually exclusive districts. Names preserve official candidate-list spelling and uppercase. State/county source facts, not endorsements.'})
(outdir/'composite-ballot.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
files=sorted(p.glob('sample-page-*.txt'),key=lambda x:int(x.stem.split('-')[-1]))
alltext='\n'.join('===== PDF PAGE '+f.stem.split('-')[-1]+' =====\n'+f.read_text() for f in files)
(p/'sample-ballots-decoded.txt').write_text(alltext)
sample='\n'.join('===== PDF PAGE '+str(i)+' =====\n'+(p/f'sample-page-{i}.txt').read_text() for i in range(180,196))
(p/'oakland-bt48-sample.txt').write_text(sample)
flat=re.sub(r'\s+',' ',sample).upper()
selected=[c for c in contests if c['type']=='retention' or c['id'].startswith('ca-proposition-') or c['id'] in ['alameda-measure-rtm','alameda-measure-ee','alameda-measure-ff'] or (c['type']=='candidate' and all(n in flat for n in c['options']))]
oak={**result,'scope':'Representative Oakland ballot: official sample ballot BT48, printed precinct 245300 (0056), county composite PDF pages 180–195. This is not asserted to match the user residence.','contests':selected,'ballotStyle':'BT48','precinctLabel':'245300 (0056)','sourcePdfPages':list(range(180,196))}
(outdir/'oakland-ballot.json').write_text(json.dumps(oak,indent=2,ensure_ascii=False)+'\n')
for f in files:f.unlink()
print('composite',len(contests),'candidate',sum(c['type']=='candidate' for c in contests),'retention',sum(c['type']=='retention' for c in contests),'measure',sum(c['type']=='measure' for c in contests),'Oakland',len(selected))
