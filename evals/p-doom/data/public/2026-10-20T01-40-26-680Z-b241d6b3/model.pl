0.75::bio_enabling.
0.10000000000000001::human_bio_release.
0.25::agent_bio_release.
0.16::bio_mortality.
0.65000000000000002::strategic_agents.
0.17999999999999999::harmful_escape.
0.040000000000000001::human_ai_crisis.
0.25::agent_nuclear_crisis.
0.25::nuclear_escalation.
0.5::nuclear_mortality.
0.80000000000000004::infra_exposure.
0.059999999999999998::human_infra_failure.
0.34999999999999998::agent_infra_failure.
0.025000000000000001::infra_mortality.
0.22::dominance.
0.34999999999999998::agent_other_mortality.
ai_campaign :- strategic_agents, harmful_escape.
bio_release :- bio_enabling, human_bio_release.
bio_release :- bio_enabling, ai_campaign, agent_bio_release.
p_doom :- bio_release, bio_mortality.
nuclear_crisis :- human_ai_crisis.
nuclear_crisis :- ai_campaign, agent_nuclear_crisis.
nuclear_exchange :- nuclear_crisis, nuclear_escalation.
p_doom :- nuclear_exchange, nuclear_mortality.
infra_shock :- infra_exposure, human_infra_failure.
infra_shock :- infra_exposure, ai_campaign, agent_infra_failure.
p_doom :- infra_shock, infra_mortality.
p_doom :- ai_campaign, dominance, agent_other_mortality.
query(ai_campaign).
query(bio_release).
query(infra_shock).
query(nuclear_crisis).
query(nuclear_exchange).
query(p_doom).
