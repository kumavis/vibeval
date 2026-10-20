0.34999999999999998::bio_enablement.
0.080000000000000002::bio_outbreak.
0.10000000000000001::bio_fatality.
0.69999999999999996::military_ai_integration.
0.025000000000000001::ai_escalation.
0.16::large_exchange.
0.5::nuclear_fatality.
0.5::agent_authority.
0.080000000000000002::agent_failure.
0.20000000000000001::agent_global_reach.
0.40000000000000002::agent_fatality.
0.080000000000000002::cyber_disruption.
0.025000000000000001::cyber_fatality.
bio_route :- bio_enablement, bio_outbreak, bio_fatality.
nuclear_route :- military_ai_integration, ai_escalation, large_exchange, nuclear_fatality.
agent_route :- agent_authority, agent_failure, agent_global_reach, agent_fatality.
cyber_route :- cyber_disruption, cyber_fatality.
p_doom :- bio_route.
p_doom :- nuclear_route.
p_doom :- agent_route.
p_doom :- cyber_route.
query(agent_route).
query(bio_route).
query(cyber_route).
query(nuclear_route).
query(p_doom).
