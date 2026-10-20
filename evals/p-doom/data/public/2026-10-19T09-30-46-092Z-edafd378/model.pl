0.5::bio_enable.
0.070000000000000007::bio_release.
0.10000000000000001::bio_deaths.
0.65000000000000002::mil_ai.
0.02::mil_trigger.
0.40000000000000002::mil_deaths.
0.55000000000000004::agent_authority.
0.059999999999999998::agent_cascade.
0.16::agent_deaths.
bio_route :- bio_enable, bio_release, bio_deaths.
mil_route :- mil_ai, mil_trigger, mil_deaths.
agent_route :- agent_authority, agent_cascade, agent_deaths.
p_doom :- bio_route.
p_doom :- mil_route.
p_doom :- agent_route.
query(agent_route).
query(bio_route).
query(mil_route).
query(p_doom).
