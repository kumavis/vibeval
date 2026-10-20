0.014999999999999999::bio_attack.
0.029999999999999999::bio_global.
0.02::nuclear_ai.
0.040000000000000001::nuclear_global.
0.0050000000000000001::loss_control.
0.080000000000000002::loss_global.
p_doom :- bio_attack, bio_global.
p_doom :- nuclear_ai, nuclear_global.
p_doom :- loss_control, loss_global.
query(p_doom).
