from pathlib import Path
import re,json
p=Path(__file__).parent
raw=p/'raw' if (p/'raw').exists() else p
s=(raw/'sample-ballots-decoded.txt').read_text();a=re.split(r'===== PDF PAGE (\d+) =====\n',s);pages={int(a[i]):a[i+1] for i in range(1,len(a),2)}
sample='\n'.join('===== PDF PAGE '+str(i)+' =====\n'+pages[i] for i in range(64,76));flat=re.sub(r'\s+',' ',sample).upper()
d=json.loads((p/'composite-ballot.json').read_text());out=[]
for c in d['contests']:
 include=c['type']=='retention' or c['id'].startswith('ca-proposition-') or c['id'] in ['alameda-measure-rtm','alameda-measure-j'] or (c['type']=='candidate' and all(n in flat for n in c['options'])) or c['id']=='for-mayor-san-leandro'
 if include:out.append(c)
for c in out:
 if c['type']=='retention':assert c['title'].split(': ')[-1].upper() in flat,c
 if c['id']=='for-mayor-san-leandro':assert 'JUAN GONZÉLEZ III' in flat and 'JAMES MAES' in flat
 if 'city-council' in c['id'] and 'san-leandro' in c['id']:c['note']='This race appears on the printed BT11 ballot. The city adopted district-based elections; printed ballots contain all four council races. See scope note and current official instructions.'
d.update(scope='Representative San Leandro printed ballot BT11, precinct label 454510 (0301), official county composite PDF pages 64–75. Not the user personal ballot and not the City Hall ballot.',contests=out,ballotStyle='BT11',precinctLabel='454510 (0301)',sourcePdfPages=list(range(64,76)),districtLabels=['U.S. House district 10','California Assembly district 20','Board of Equalization district 2','Chabot–Las Positas CCD area 2','AC Transit ward 5','BART district 4','EBMUD ward 7','San Lorenzo USD Measure J'],scopeNotes=['San Leandro City Hall geocodes to consolidated precinct 458400 in the official November 2026 map, while the available composite sample is precinct 454510 (0301), BT11. City Hall location was not used to infer or assemble this ballot.','The printed BT11 sample contains mayor and council district 1, 2 short-term, 3 and 5 contests. San Leandro passed Measure F for district elections, but printed ballots contain all four races. The October 24 county notice says the office will count and report votes and the city will determine winners from certified precinct/district results. This experiment uses the printed ballot; it is not personal voting guidance.','The official lookup returned City Hall CD12, while printed BT11 is CD10. We preserve the verified printed CD10 contest and do not mix GIS and sample ballot contents.'])
d['sources'] += [{'url':'https://acvote.alamedacountyca.gov/main/article?newsid=sanleandro','title':'October 24 2026 county notice; full live HTML saved; web text fetch intermittently errors'},{'url':'https://sanleandro.legistar.com/LegislationDetail.aspx?FullText=1&GUID=FC539250-F086-4D6D-9762-C7259CB1DDA4&ID=8285082&Options=&Search=','title':'October 12 2026 municipal report, Reso 2026-131, printed ballot and district tabulation'}]
d['methodology']['retentionVerification']='All 13 state and First Appellate District retention names occur on BT11 PDF pages 64–67.'
d['methodology']['representativeSelection']='Selected one complete official printed San Leandro style, BT11; no collage of contests from other precincts.'
(p/'san-leandro-ballot.json').write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
(raw/'san-leandro-bt11-sample.txt').write_text(sample)
print('Ready',len(out),'contests',len([c for c in out if c['type']=='candidate']),'candidate',len([c for c in out if c['type']=='retention']),'retention',len([c for c in out if c['type']=='measure']),'measure')
