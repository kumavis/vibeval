0.65000000000000002::bio_ai_uplift.
0.070000000000000007::bio_release.
0.12::bio_threshold.
0.69999999999999996::military_ai_use.
0.029999999999999999::ai_driven_nuclear.
0.34999999999999998::nuclear_threshold.
0.65000000000000002::agent_authority.
0.10000000000000001::severe_misalignment.
0.20000000000000001::loss_control.
0.34999999999999998::loss_threshold.
0.025000000000000001::cyber_global.
0.035000000000000003::cyber_threshold.
bio_catastrophe :- bio_ai_uplift, bio_release, bio_threshold.
nuclear_catastrophe :- military_ai_use, ai_driven_nuclear, nuclear_threshold.
control_catastrophe :- agent_authority, severe_misalignment, loss_control, loss_threshold.
cyber_catastrophe :- agent_authority, cyber_global, cyber_threshold.
p_doom :- bio_catastrophe.
p_doom :- nuclear_catastrophe.
p_doom :- control_catastrophe.
p_doom :- cyber_catastrophe.
query(bio_catastrophe).
query(control_catastrophe).
query(cyber_catastrophe).
query(nuclear_catastrophe).
query(p_doom).
