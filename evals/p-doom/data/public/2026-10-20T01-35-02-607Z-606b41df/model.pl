0.80000000000000004::bio_access.
0.17999999999999999::bio_release.
0.10000000000000001::bio_deaths.
0.69999999999999996::nuclear_exposure.
0.040000000000000001::nuclear_trigger.
0.29999999999999999::nuclear_deaths.
0.65000000000000002::digital_exposure.
0.29999999999999999::digital_containment_gap.
0.17999999999999999::autonomous_campaign.
0.45000000000000001::autonomous_deaths.
0.14999999999999999::infrastructure_shock.
0.040000000000000001::infrastructure_deaths.
bio_hazard :- bio_access, bio_release.
nuclear_hazard :- nuclear_exposure, nuclear_trigger.
digital_vulnerable :- digital_exposure, digital_containment_gap.
autonomy_hazard :- digital_vulnerable, autonomous_campaign.
infrastructure_hazard :- digital_vulnerable, infrastructure_shock.
p_doom :- bio_hazard, bio_deaths.
p_doom :- nuclear_hazard, nuclear_deaths.
p_doom :- autonomy_hazard, autonomous_deaths.
p_doom :- infrastructure_hazard, infrastructure_deaths.
query(autonomy_hazard).
query(bio_hazard).
query(digital_vulnerable).
query(infrastructure_hazard).
query(nuclear_hazard).
query(p_doom).
