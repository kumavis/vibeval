0.59999999999999998::frontier_capability.
0.20000000000000001::bio_attempt.
0.12::bio_success.
0.25::bio_mortality.
0.050000000000000003::misalignment_event.
0.40000000000000002::control_lethal.
0.02::ai_war_trigger.
0.29999999999999999::nuclear_mortality.
0.01::cyber_collapse.
0.14999999999999999::cyber_mortality.
0.80000000000000004::window_timing.
0.84999999999999998::ai_attribution.
bio_route :- frontier_capability, bio_attempt, bio_success, bio_mortality.
control_route :- frontier_capability, misalignment_event, control_lethal.
war_route :- ai_war_trigger, nuclear_mortality.
cyber_route :- frontier_capability, cyber_collapse, cyber_mortality.
catastrophe_core :- bio_route.
catastrophe_core :- control_route.
catastrophe_core :- war_route.
catastrophe_core :- cyber_route.
p_doom :- catastrophe_core, window_timing, ai_attribution.
query(bio_route).
query(catastrophe_core).
query(control_route).
query(cyber_route).
query(p_doom).
query(war_route).
