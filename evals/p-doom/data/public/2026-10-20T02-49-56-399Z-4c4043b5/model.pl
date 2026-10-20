0.90000000000000002::autonomous_agent_capability.
0.040000000000000001::ai_cyber_infrastructure_collapse.
0.01::cyber_collapse_exceeds_10pct.
0.01::ai_bio_uplift_attack.
0.01::ai_bio_pandemic_exceeds_10pct.
0.02::ai_military_war_trigger.
0.10000000000000001::war_exceeds_10pct.
0.02::loss_of_control_disempowerment.
0.5::loss_of_control_exceeds_10pct.
0.02::ai_critical_system_failure.
0.01::critical_failure_exceeds_10pct.
p_doom :- autonomous_agent_capability, ai_cyber_infrastructure_collapse, cyber_collapse_exceeds_10pct.
p_doom :- ai_bio_uplift_attack, ai_bio_pandemic_exceeds_10pct.
p_doom :- ai_military_war_trigger, war_exceeds_10pct.
p_doom :- autonomous_agent_capability, loss_of_control_disempowerment, loss_of_control_exceeds_10pct.
p_doom :- autonomous_agent_capability, ai_critical_system_failure, critical_failure_exceeds_10pct.
query(p_doom).
