0.5::cap_gate.
0.14999999999999999::bio_attempt.
0.40000000000000002::bio_safeguards_fail.
0.25::bio_spread.
0.29999999999999999::bio_mort.
0.029999999999999999::ctrl_takeover.
0.40000000000000002::ctrl_mort.
0.040000000000000001::war_trigger.
0.12::war_mort.
0.029999999999999999::cyber_collapse.
0.10000000000000001::cyber_mort.
0.75::window_ok.
bio_release :- cap_gate, bio_attempt, bio_safeguards_fail.
bio_catastrophe :- bio_release, bio_spread, bio_mort.
ctrl_catastrophe :- cap_gate, ctrl_takeover, ctrl_mort.
war_catastrophe :- cap_gate, war_trigger, war_mort.
cyber_catastrophe :- cap_gate, cyber_collapse, cyber_mort.
p_doom :- bio_catastrophe, window_ok.
p_doom :- ctrl_catastrophe, window_ok.
p_doom :- war_catastrophe, window_ok.
p_doom :- cyber_catastrophe, window_ok.
query(bio_catastrophe).
query(bio_release).
query(ctrl_catastrophe).
query(cyber_catastrophe).
query(p_doom).
query(war_catastrophe).
