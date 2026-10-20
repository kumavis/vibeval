0.80000000000000004::digital_exposure.
0.59999999999999998::strategic_capability.
0.20000000000000001::harmful_campaign.
0.25::containment_failure.
0.65000000000000002::bio_access.
0.14999999999999999::human_bio_release.
0.34999999999999998::agent_bio_release.
0.12::bio_mortality.
0.84999999999999998::military_ai_use.
0.025000000000000001::human_nuclear_trigger.
0.059999999999999998::agent_nuclear_trigger.
0.34999999999999998::nuclear_mortality.
0.10000000000000001::service_shock.
0.59999999999999998::agent_service_shock.
0.029999999999999999::service_mortality.
0.14999999999999999::coercive_mortality.
agent_ready :- digital_exposure, strategic_capability.
agent_campaign :- agent_ready, harmful_campaign.
persistent_loss :- agent_campaign, containment_failure.
bio_event :- bio_access, human_bio_release.
bio_event :- bio_access, persistent_loss, agent_bio_release.
nuclear_event :- military_ai_use, human_nuclear_trigger.
nuclear_event :- military_ai_use, persistent_loss, agent_nuclear_trigger.
service_event :- digital_exposure, service_shock.
service_event :- persistent_loss, agent_service_shock.
p_doom :- bio_event, bio_mortality.
p_doom :- nuclear_event, nuclear_mortality.
p_doom :- service_event, service_mortality.
p_doom :- persistent_loss, coercive_mortality.
query(agent_campaign).
query(agent_ready).
query(bio_event).
query(nuclear_event).
query(p_doom).
query(persistent_loss).
query(service_event).
