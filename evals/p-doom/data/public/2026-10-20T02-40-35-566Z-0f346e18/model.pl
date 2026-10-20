0.59999999999999998::frontier_capability.
0.59999999999999998::safeguards_fail.
0.59999999999999998::bio_uplift.
0.20000000000000001::bio_attempt.
0.29999999999999999::bio_spread.
0.12::bio_lethal.
0.25::ctrl_misaligned.
0.25::ctrl_unrecoverable.
0.25::ctrl_lethal.
0.01::mil_escalation.
0.29999999999999999::nuc_lethal.
0.10000000000000001::cyber_systemic.
0.050000000000000003::cyber_lethal.
bio_path :- frontier_capability, safeguards_fail, bio_uplift, bio_attempt, bio_spread, bio_lethal.
control_path :- frontier_capability, safeguards_fail, ctrl_misaligned, ctrl_unrecoverable, ctrl_lethal.
nuclear_path :- mil_escalation, nuc_lethal.
cyber_path :- frontier_capability, safeguards_fail, cyber_systemic, cyber_lethal.
p_doom :- bio_path.
p_doom :- control_path.
p_doom :- nuclear_path.
p_doom :- cyber_path.
query(bio_path).
query(control_path).
query(cyber_path).
query(nuclear_path).
query(p_doom).
