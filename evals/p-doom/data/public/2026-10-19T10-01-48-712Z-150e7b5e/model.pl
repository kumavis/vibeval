0.65000000000000002::capable_ai.
0.025000000000000001::bio_release.
0.040000000000000001::bio_threshold.
0.040000000000000001::ai_crisis.
0.029999999999999999::nuclear_use.
0.25::nuclear_threshold.
0.025000000000000001::control_loss.
0.12::control_threshold.
bio_catastrophe :- capable_ai, bio_release, bio_threshold.
nuclear_catastrophe :- capable_ai, ai_crisis, nuclear_use, nuclear_threshold.
control_catastrophe :- capable_ai, control_loss, control_threshold.
p_doom :- bio_catastrophe.
p_doom :- nuclear_catastrophe.
p_doom :- control_catastrophe.
query(bio_catastrophe).
query(control_catastrophe).
query(nuclear_catastrophe).
query(p_doom).
