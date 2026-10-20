0.080000000000000002::bio_misuse.
0.025000000000000001::pandemic_threshold.
0.02::nuclear_escalation.
0.14999999999999999::nuclear_threshold.
0.014999999999999999::loss_control.
0.25::control_threshold.
0.69999999999999996::leap_timing.
bio_catastrophe :- bio_misuse, pandemic_threshold, leap_timing.
nuclear_catastrophe :- nuclear_escalation, nuclear_threshold, leap_timing.
control_catastrophe :- loss_control, control_threshold, leap_timing.
p_doom :- bio_catastrophe.
p_doom :- nuclear_catastrophe.
p_doom :- control_catastrophe.
query(bio_catastrophe).
query(control_catastrophe).
query(nuclear_catastrophe).
query(p_doom).
